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
import { listApplicationFilePaths } from "../db/files";
import { getFilesRoot } from "../db/settings";
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

export async function deleteApplicationWithFiles(id: number, expected: Expected): Promise<DeleteWithFilesResult> {
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
      const t = await resolveInRoot(root, p);
      if (!t.ok) throw new Error(t.error);
      const st = await plainStat(realRoot, p, t.path);
      if (!st?.isFile()) throw new Error("Not a plain stored file: a symlink or something else is in its place.");
      const unlock = process.platform === "win32" && st.nlink === 1; // uploads are read-only (0o444); Windows cannot unlink those
      if (unlock) await chmod(t.path, 0o666).catch(() => {});
      await unlink(t.path).catch(async (e) => {
        if (unlock) await chmod(t.path, st.mode & 0o7777).catch(() => {}); // keep it read-only when it stays
        throw e;
      });
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
