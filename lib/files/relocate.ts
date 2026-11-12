// Server-only. Relocate the files root (8.10, FR-13.1, FR-5.6, NFR-6, AT-14). Two explicit ways, both run by the caller while it holds the
// lock (lib/files/lock.ts) and both finish with switchFilesRoot, which saves the setting only if the live files are still exactly the set
// that was moved or found (an upload or delete in between changes the set, so the switch refuses). Tombstoned files (8.8) have no bytes and are ignored.
//
// moveStoredFiles: the new folder must exist (as for any files root), be empty, and not contain, sit inside or equal the current root or the backup folder.
//  1. every live file, in id order: lstat the source (must be a plain file), then rename it into the same relative path in the new folder (same file
//     system: nothing is read or written). If the rename says EXDEV (another file system) the file is COPIED instead (COPYFILE_EXCL), its SHA-256 is
//     checked against the database, and the copy is made read-only (0444, as store.ts does). A copy that differs from the record but matches its
//     source is a file already changed since upload: it moves as it is and is flagged 'mismatch' (a rename would carry it the same way).
//  2. switchFilesRoot.  3. only after the switch: remove the sources of copied files, then the old application folders that are now empty (rmdir only).
// Any failure in 1-2 puts everything back (renames reversed, copies removed, the folders made removed) and the old root stays in use. A failure in
// 3 is a warning: the setting has switched and the data is safe in the new folder. Files Dossier did not store (dropped in by hand, FR-5.11) are never
// touched: they stay in the old folder, which is itself never removed, and the result says so. Limit: a crash (power loss, kill) mid-move can leave
// files split between the two folders; the setting still names the old one, so re-pointing it at the new folder after moving the rest back
// (or the other way round) fixes it.
//
// repointStoredFiles: the user already moved the folder. Every live row's path must exist in the new folder as a plain file with the recorded size
// (the hash is NOT re-read here: that would read every byte of the archive in one request; Open and Check files verify it later). A refusal
// lists the first few problems and saves nothing. There is deliberately no override in v1.
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readdir, realpath, rename, rmdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getBackupDestination } from "../db/backup";
import { listLiveFiles, recordIntegrity, switchFilesRoot } from "../db/files";
import { getFilesRoot } from "../db/settings";
import { parseExpected, problemsMessage, sumBytes, targetRefusal, type LiveFile } from "../relocate";
import { resolveInRoot } from "./resolve";
import { validateFilesRoot } from "./root";

export type MoveResult = { ok: true; path: string; moved: number; bytes: number; renamed: number; copied: number; warnings: string[] } | { ok: false; error: string };
export type RepointResult = { ok: true; path: string; checked: number } | { ok: false; error: string };

const fail = (error: string) => ({ ok: false, error }) as const;
const code = (e: unknown) => (e as NodeJS.ErrnoException).code;
class Shown extends Error {} // its message is already written for the user
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
// A read-only file cannot be removed on Windows, so make it writable first.
const removeFile = async (p: string) => { await chmod(p, 0o666).catch(() => {}); await rm(p, { force: true }); };

async function sha256Of(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

// Every folder between `abs` and `top` (exclusive), deepest first: the application folders a move created or emptied.
function foldersBelow(top: string, abs: string[]): string[] {
  const all = new Set<string>();
  for (const a of abs) for (let d = dirname(a); d !== top && d.startsWith(top) && !all.has(d); d = dirname(d)) all.add(d);
  return [...all].sort((x, y) => y.length - x.length);
}

type Step = { src: string; dst: string; copied: boolean };

export async function moveStoredFiles(input: unknown, expected: unknown, deps: { rename?: typeof rename; copyFile?: typeof copyFile } = {}): Promise<MoveResult> {
  const move = deps.rename ?? rename;
  const copy = deps.copyFile ?? copyFile;
  const exp = parseExpected(expected);
  if (!exp) return fail("Moving must be confirmed.");
  const v = await validateFilesRoot(input);
  if (!v.ok) return v;
  const from = await getFilesRoot();
  if (!from) return fail("There is no current files folder to move. Choose Re-point to use a folder that already holds your files.");
  const fromReal = await realpath(from).catch(() => null);
  if (!fromReal) return fail(`The current files folder ${from} cannot be found. If you moved it yourself, choose Re-point instead.`);
  const toReal = await realpath(v.path);
  const backup = await getBackupDestination();
  const refusal = targetRefusal(fromReal, toReal, backup ? await realpath(backup).catch(() => resolve(backup)) : null);
  if (refusal) return fail(refusal);
  if ((await readdir(v.path)).length > 0) return fail("The new folder is not empty. Choose an empty folder so nothing is mixed up.");

  const live = await listLiveFiles();
  if (live.length !== exp.fileCount || sumBytes(live) !== exp.totalBytes) return fail("Your files changed since the confirmation was shown. Check again.");

  const plan: { f: LiveFile; src: string; dst: string }[] = [];
  for (const f of live) {
    const [src, dst] = await Promise.all([resolveInRoot(from, f.relativePath), resolveInRoot(v.path, f.relativePath)]);
    if (!src.ok) return fail(`"${f.relativePath}": ${src.error}`);
    if (!dst.ok) return fail(`"${f.relativePath}": ${dst.error}`);
    plan.push({ f, src: src.path, dst: dst.path });
  }

  const done: Step[] = [];
  const target = resolve(v.path);
  try {
    for (const { f, src, dst } of plan) {
      const st = await lstat(src).catch((e) => { throw code(e) === "ENOENT" ? new Shown(`"${f.relativePath}" is missing from the current files folder. Run Check files, or choose Re-point if you moved the folder yourself.`) : e; });
      if (!st.isFile()) throw new Shown(`"${f.relativePath}" is not a plain file in the current files folder (a link or folder is in its place).`);
      await mkdir(dirname(dst), { recursive: true });
      try {
        await move(src, dst); // same file system: no bytes are read or written
        done.push({ src, dst, copied: false });
      } catch (e) {
        if (code(e) !== "EXDEV") throw e;
        await copy(src, dst, constants.COPYFILE_EXCL);
        done.push({ src, dst, copied: true }); // registered before the check, so a bad copy is removed by the rollback
        const got = await sha256Of(dst);
        if (got !== f.sha256) {
          // A file already changed since upload (AT-8) is copied as it is and stays flagged, as a same-drive rename would carry it.
          if (got !== (await sha256Of(src))) throw new Shown(`"${f.relativePath}" did not copy correctly: the copy differs from the original. Check the new drive and try again.`);
          await recordIntegrity(f.id, "mismatch");
        }
        await chmod(dst, 0o444);
      }
    }
    if (!(await switchFilesRoot(v.path, live))) throw new Shown("Your files changed while they were being moved (an upload or a delete). Nothing was changed; try again.");
  } catch (e) {
    const stuck: string[] = [];
    for (const s of done.reverse()) {
      try {
        if (s.copied) await removeFile(s.dst);
        else await move(s.dst, s.src);
      } catch {
        stuck.push(s.dst);
      }
    }
    for (const d of foldersBelow(target, plan.map((p) => p.dst))) await rmdir(d).catch(() => {});
    if (!(e instanceof Shown)) console.error("Move files root failed", e);
    const why = e instanceof Shown ? e.message : `The move failed: ${(e as Error).message}`;
    return fail(`${why} Your files folder was not changed.${stuck.length ? ` Dossier could not undo the move of ${plural(stuck.length, "file")}; they are in ${v.path}: ${stuck.slice(0, 3).join(", ")}.` : ""}`);
  }

  // The setting has switched. From here nothing is rolled back: problems are reported.
  const warnings: string[] = [];
  let notRemoved = 0;
  for (const s of done.filter((d) => d.copied)) await removeFile(s.src).catch(() => { notRemoved++; });
  let kept = 0;
  for (const d of foldersBelow(resolve(from), plan.map((p) => p.src))) {
    await rmdir(d).catch((e) => { if (code(e) !== "ENOENT") kept++; });
  }
  if (notRemoved) warnings.push(`${plural(notRemoved, "old copy")} could not be removed from ${from}. They are safe to delete by hand.`);
  if (kept) warnings.push(`${plural(kept, "folder")} in ${from} still hold files Dossier did not store, so they were left there.`);
  warnings.push(`The old folder ${from} itself was not removed.`);
  const copied = done.filter((d) => d.copied).length;
  return { ok: true, path: v.path, moved: done.length, bytes: sumBytes(live), renamed: done.length - copied, copied, warnings };
}

export async function repointStoredFiles(input: unknown): Promise<RepointResult> {
  const v = await validateFilesRoot(input);
  if (!v.ok) return v;
  const live = await listLiveFiles();
  const problems: string[] = [];
  for (const f of live) {
    const t = await resolveInRoot(v.path, f.relativePath);
    const st = t.ok ? await stat(t.path).catch(() => null) : null;
    if (!st?.isFile()) problems.push(`${f.relativePath} (missing)`);
    else if (st.size !== f.sizeBytes) problems.push(`${f.relativePath} (size differs)`);
  }
  if (problems.length) return fail(problemsMessage(problems));
  if (!(await switchFilesRoot(v.path, live))) return fail("Your files changed while they were being checked (an upload or a delete). Nothing was changed; try again.");
  return { ok: true, path: v.path, checked: live.length };
}
