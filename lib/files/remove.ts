// Server-only. Deletes an application and then its files on disk (NFR-4, FR-5.8). Order and why:
//  1. read the stored paths (the rows vanish with the delete)  2. delete the DB rows (transaction and stale-count guards unchanged)
//  3. unlink each file  4. rmdir the application folder, which only succeeds when it is empty.
// The DB goes first so a failed or refused delete never loses files, and a failure in 3-4 leaves orphan files, never rows pointing at
// nothing. Failures after step 2 do not undo it: they are logged and returned as `warning`. Only files the app stored are touched, and
// the folder is never removed recursively, so a file dropped in by hand (FR-5.11) survives and keeps its folder.
// Symlinks: resolveInRoot accepts links whose target stays inside the root (fine for reading). Unlinking through one could delete
// another application's file, so a stored path with a symlink anywhere below the root, or that is itself a link, is left alone and
// reported. Same check-then-act limit as resolveInRoot (a link swapped in between is not caught).
// Hard links: chmod changes the shared inode, so it would loosen another application's file or one outside the root. POSIX never
// chmods (unlink needs write permission on the folder, not the file), so only the stored name goes and other links keep their mode.
// Windows must clear read-only to unlink, so it does that only when nlink is 1; a hard-linked file there fails to unlink and is reported.
import { chmod, lstat, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname as absDirname, join } from "node:path";
import { dirname } from "node:path/posix";
import { deleteApplication, type DeleteResult } from "../db/applications";
import { abortFileDelete, beginFileDelete, finishFileDelete, listApplicationFilePaths } from "../db/files";
import { getFilesRoot } from "../db/settings";
import { beginWrite } from "./lock";
import { resolveInRoot } from "./resolve";

export type DeleteWithFilesResult = DeleteResult | { ok: true; trackId: number; warning: string };
type Expected = { cellCount: number; fileCount: number; submissionCount: number; noteCount: number };
const code = (e: unknown) => (e as NodeJS.ErrnoException).code;
const plural = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

// lstat of `abs` (throws ENOENT when gone), or null when a folder between the root and `abs` is a symlink.
async function plainStat(realRoot: string, rel: string, abs: string) {
  const st = await lstat(abs);
  return (await realpath(absDirname(abs))) === join(realRoot, ...dirname(rel).split("/")) ? st : null;
}

// Removes one stored file (the symlink and read-only rules in the header). Throws: ENOENT = already gone, anything else = could not remove.
async function unlinkStored(root: string, realRoot: string, rel: string): Promise<void> {
  const t = await resolveInRoot(root, rel);
  if (!t.ok) throw new Error(t.error);
  const st = await plainStat(realRoot, rel, t.path);
  if (!st?.isFile()) throw new Error("Not a plain stored file: a symlink or something else is in its place.");
  const unlock = process.platform === "win32" && st.nlink === 1; // uploads are read-only (0o444); Windows cannot unlink those
  if (unlock) await chmod(t.path, 0o666).catch(() => {});
  await unlink(t.path).catch(async (e) => {
    if (unlock) await chmod(t.path, st.mode & 0o7777).catch(() => {}); // keep it read-only when it stays
    throw e;
  });
}

// Both deletes register with the shared lock (lock.ts): refused while a move or restore runs, and those wait for them.
const asWrite = async <T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> => {
  const write = beginWrite();
  if (!write.ok) return write;
  try {
    return await fn();
  } finally {
    write.end();
  }
};

export const deleteApplicationWithFiles = (id: number, expected: Expected): Promise<DeleteWithFilesResult> => asWrite(() => deleteApplicationUnlocked(id, expected));

async function deleteApplicationUnlocked(id: number, expected: Expected): Promise<DeleteWithFilesResult> {
  const paths = await listApplicationFilePaths(id);
  const r = await deleteApplication(id, expected);
  if (!r.ok || paths.length === 0) return r;
  const folders = [...new Set(paths.map((p) => dirname(p)))].filter((f) => f !== ".");
  const where = folders.join(", ") || "the files folder";

  const root = await getFilesRoot();
  const realRoot = root ? await realpath(root).catch(() => null) : null;
  if (!root || !realRoot) return { ...r, warning: `Deleted, but the files folder is not set or cannot be reached, so ${plural(paths.length)} in ${where} ${paths.length === 1 ? "was" : "were"} left on disk.` };

  let failed = 0, missing = 0;
  for (const p of paths) {
    try {
      await unlinkStored(root, realRoot, p);
    } catch (e) {
      if (code(e) === "ENOENT") { missing++; continue; } // already gone: nothing left to remove
      failed++;
      console.error("Could not remove file of deleted application", p, e);
    }
  }

  const kept: string[] = [], stuck: string[] = [];
  for (const f of folders) {
    try {
      const t = await resolveInRoot(root, f);
      if (!t.ok) throw new Error(t.error);
      const st = await plainStat(realRoot, f, t.path);
      if (!st?.isDirectory()) throw new Error("Not a plain folder: a symlink or something else is in its place.");
      await rmdir(t.path);
    } catch (e) {
      if (code(e) === "ENOENT") continue;
      if (code(e) === "ENOTEMPTY" || code(e) === "EEXIST") kept.push(f);
      else {
        stuck.push(f);
        console.error("Could not remove folder of deleted application", f, e);
      }
    }
  }

  const problems = [
    ...(failed > 0 ? [`${plural(failed)} could not be removed from ${where}`] : []),
    ...(stuck.length > 0 ? [`the folder ${stuck.join(", ")} could not be removed`] : []),
  ];
  const notes = [
    ...(missing > 0 ? [`${plural(missing)} ${missing === 1 ? "was" : "were"} already missing from disk.`] : []),
    // With failed files the folder is not empty anyway, so "files Dossier did not store" might not be true.
    ...(kept.length > 0 && failed === 0 ? [`The folder ${kept.join(", ")} was kept because it holds files Dossier did not store.`] : []),
  ];
  if (problems.length === 0 && notes.length === 0) return r;
  return { ...r, warning: [problems.length > 0 ? `Deleted, but ${problems.join(" and ")}.` : "Deleted.", ...notes].join(" ") };
}

// Deletes ONE stored file (8.8, FR-5.8). The user has already confirmed (and, for a submitted file, ticked the extra warning) in the UI;
// `expectedSubmissions` is the number of submissions the dialog showed. Order and what a crash leaves:
//  1. beginFileDelete: stale check + set deleted_at, one transaction (a refusal changes nothing; after it no submission can pick the file)
//  2. remove the bytes (unlinkStored: same symlink and read-only rules as an application delete; already gone is fine). FR-5.8's "unlock":
//     on POSIX unlinking needs write permission on the folder, not the file, so the file is never chmodded (a chmod would loosen a hard-linked
//     copy elsewhere, SEC.1); on Windows it is made writable first when it has one link.
//  3. finishFileDelete: one transaction writes the history event and drops the row, or keeps it as the submissions' record; a dropped
//     row's folder is removed if it is now empty (rmdir only, so files dropped in by hand keep it)
// A failure in 2 undoes 1 (the file is untouched and live again). A crash between 1 and 2 leaves a marked row and the bytes on disk (listed
// nowhere, harmless, still in backups); between 2 and 3 a marked row without bytes and no history line. Never a live row without bytes
// except through the "missing" state the integrity check already reports, and never bytes without a row.
export type DeleteFileResult = { ok: true; kept: boolean } | { ok: false; error: string };

export const deleteStoredFile = (id: number, expectedSubmissions: number): Promise<DeleteFileResult> => asWrite(() => deleteStoredFileUnlocked(id, expectedSubmissions));

async function deleteStoredFileUnlocked(id: number, expectedSubmissions: number): Promise<DeleteFileResult> {
  const begin = await beginFileDelete(id, expectedSubmissions);
  if (!begin.ok) return begin;
  const undo = async (error: string): Promise<DeleteFileResult> => {
    await abortFileDelete(id).catch((e) => console.error("Could not undo the file delete", id, e));
    return { ok: false, error };
  };
  const root = await getFilesRoot();
  const realRoot = root ? await realpath(root).catch(() => null) : null;
  if (!root || !realRoot) return undo("The files folder is not set or cannot be reached, so the file was not deleted. Check it in Settings.");
  try {
    await unlinkStored(root, realRoot, begin.relativePath);
  } catch (e) {
    if (code(e) !== "ENOENT" && code(e) !== "ENOTDIR") {
      console.error("Could not remove file", begin.relativePath, e);
      return undo("The file could not be removed from the files folder, so nothing was deleted. Check its permissions and try again.");
    }
  }
  const kept = await finishFileDelete(id);
  if (!kept) await rmdirQuietly(root, realRoot, begin.relativePath); // an application with no files left must not keep an empty folder that the next upload would not reuse
  return { ok: true, kept };
}

// Removes the file's folder if it is empty (rmdir refuses otherwise, so files dropped in by hand keep it). Any failure is ignored: it is only tidying.
async function rmdirQuietly(root: string, realRoot: string, fileRel: string): Promise<void> {
  const folder = dirname(fileRel);
  if (folder === ".") return;
  try {
    const t = await resolveInRoot(root, folder);
    if (t.ok && (await plainStat(realRoot, folder, t.path))?.isDirectory()) await rmdir(t.path);
  } catch { /* not empty, gone, or not ours to remove */ }
}
