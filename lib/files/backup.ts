// Server-only. "Back up now" (FR-12.1): writes ONE zip into a folder the user chooses. Layout and manifest: lib/backup.ts.
//  1. check the destination  2. list the files under the files root (read-only: nothing under the root is touched)
//  3. copy the database with SQLite's online backup into a private temp folder  4. zip manifest + db copy + files
//  5. record the time in settings (only after the zip is complete).
// Destination refusals: not a full path, not an existing folder, not writable, inside the files root (the zip would contain itself),
// or inside the project folder / database folder (the same set the files root refuses): a backup next to the live data is lost with it.
// The zip name is claimed with O_EXCL, so an existing file is never overwritten. Any failure deletes the zip and the temp folder.
// Limits: a crash (power loss, kill) mid-write leaves an unfinished zip that does not open; nothing sweeps it. The files root is read
// with lstat and symlinks are skipped, so nothing outside the root is read; a file replaced by a symlink (or a folder) during the
// backup fails it, so files/ only ever holds regular files.
// turbopackIgnore comments on three fs calls: without them Next warns that the build traces the whole project (they take user-typed paths on purpose).
// Errors name their source: an unwritable destination, an unreadable file or folder in the files root (with its relative path),
// or a generic failure (e.g. the database copy).
import { mkdtemp, lstat, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { join, relative, resolve } from "node:path";
import { ZipArchive } from "archiver";
import { backupFileName, buildManifest, DB_ENTRY, FILES_PREFIX, MANIFEST_NAME } from "../backup";
import { copyDatabaseTo, getSchemaVersion, recordBackup } from "../db/backup";
import { getFilesRoot } from "../db/settings";
import { isFullyAbsolute } from "./relative";
import { appDirs, isInside } from "./root";

export type BackupResult =
  | { ok: true; path: string; sizeBytes: number; fileCount: number; filesBytes: number; filesRoot: string | null; createdAt: string }
  | { ok: false; error: string };

const MAX_NAME_TRIES = 1000;
const fail = (error: string): BackupResult => ({ ok: false, error });
const code = (e: unknown) => (e as NodeJS.ErrnoException).code;
const isPermission = (e: unknown) => ["EACCES", "EPERM", "EROFS"].includes(code(e) ?? "");

class ShownError extends Error {} // its message is already written for the user

// The user-facing message for a failure after the checks. Errors carrying a path inside the files root came from reading it.

function explain(e: unknown, rootReal: string | null): string {
  if (e instanceof ShownError) return e.message;
  const p = (e as NodeJS.ErrnoException).path;
  if (rootReal && typeof p === "string" && isInside(p, rootReal)) {
    const rel = relative(rootReal, p);
    const what = rel ? `"${rel}" in your files folder` : "your files folder";
    return isPermission(e)
      ? `Dossier cannot read ${what}. Check its permissions, then back up again.`
      : `Dossier could not read ${what} (${code(e) ?? (e as Error).message}). Check that it is still there, then back up again.`;
  }
  return `The backup failed: ${(e as Error).message}`;
}

type Found = { abs: string; name: string; size: number };

// Regular files only, depth first. Symlinks and other special entries are skipped; folders that are (or sit in) the app's own
// folders are skipped, for a root that contains the app (the files root's own refusal covers a root placed inside it).
async function listFiles(root: string, skip: string[]): Promise<Found[]> {
  const out: Found[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.some((d) => isInside(abs, d))) await walk(abs, `${prefix}${e.name}/`);
      } else if (e.isFile()) {
        out.push({ abs, name: prefix + e.name, size: (await lstat(abs)).size });
      }
    }
  };
  await walk(root, "");
  return out;
}

async function claimZip(dir: string, now: Date) {
  for (let n = 1; n <= MAX_NAME_TRIES; n++) {
    const path = join(dir, backupFileName(now, n));
    try {
      return { path, handle: await open(path, "wx") };
    } catch (e) {
      if (code(e) !== "EEXIST") throw e;
    }
  }
  throw new Error("Too many backups with the same name.");
}

type Checked = { ok: true; typed: string; dest: string; root: string | null; rootReal: string | null; skip: string[] } | { ok: false; error: string };

const no = (error: string): Checked => ({ ok: false, error });

// The destination checks, shared by "save the destination" (8.2) and createBackup. Writability is only found out when the zip is claimed.
async function checkDestination(destination: unknown): Promise<Checked> {
  if (typeof destination !== "string" || destination.trim() === "") return no("Enter the full path of the folder for the backup.");
  const typed = destination.trim();
  if (typed.includes("\0") || !isFullyAbsolute(typed)) return no("Use the full path of an existing folder, such as /home/you/Backups. Relative paths and ~ are not accepted.");

  let dest: string;
  try {
    dest = await realpath(typed);
    if (!(await stat(dest)).isDirectory()) return no("That path is a file, not a folder.");
  } catch {
    return no("That folder does not exist. Create it first, then back up.");
  }

  const root = await getFilesRoot();
  let rootReal: string | null = null;
  const skip = await appDirs();
  if (root) {
    try {
      rootReal = await realpath(root);
      if (!(await stat(/*turbopackIgnore: true*/ rootReal)).isDirectory()) throw new Error();
    } catch {
      return no(`The files folder ${root} cannot be found, so its files cannot be backed up. Fix it in Settings first.`);
    }
    if (skip.some((d) => isInside(rootReal!, d))) return no("The files folder is inside the Dossier app folder, so it cannot be backed up. Choose another one in Settings.");
    if (isInside(dest, rootReal)) return no("Choose a backup folder outside your files folder, or the backup would contain itself.");
  }
  if (skip.some((d) => isInside(dest, d))) return no("Choose a folder outside the Dossier app folder and its data folder, so the backup survives if the app data is lost.");
  return { ok: true, typed, dest, root, rootReal, skip };
}

// Validate a destination for saving; returns the path to store (as typed, normalised).
export async function validateBackupDestination(destination: unknown): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const c = await checkDestination(destination);
  return c.ok ? { ok: true, path: resolve(/*turbopackIgnore: true*/ c.typed) } : c;
}

export async function createBackup(destination: unknown, now: Date = new Date()): Promise<BackupResult> {
  const checked = await checkDestination(destination);
  if (!checked.ok) return checked;
  const { dest, root, rootReal, skip } = checked;

  let zipPath: string | undefined;
  const tmp = await mkdtemp(join(tmpdir(), "dossier-backup-"));
  try {
    const found = rootReal ? await listFiles(rootReal, skip) : [];
    const dbCopy = join(tmp, "dossier.db");
    await copyDatabaseTo(dbCopy);
    const filesBytes = found.reduce((s, f) => s + f.size, 0);
    const manifest = buildManifest({ createdAt: now.toISOString(), schema: getSchemaVersion(), filesRoot: root, fileCount: found.length, filesBytes });

    let claimed;
    try {
      claimed = await claimZip(dest, now);
    } catch (e) {
      return fail(isPermission(e) ? "Dossier cannot write to that folder. Check its permissions." : `The backup failed: ${(e as Error).message}`);
    }
    const { path, handle } = claimed;
    zipPath = path;
    const out = handle.createWriteStream();
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const written = new Promise<void>((resolve, reject) => {
      out.on("close", resolve);
      out.on("error", reject);
      archive.on("error", reject);
      archive.on("warning", reject); // a vanished file fails the backup rather than leaving a gap
      // archiver stores a symlink (or folder) found at a listed path as such; refuse it so files/ holds regular files only
      archive.on("entry", (d) => {
        if (d.name.startsWith(FILES_PREFIX) && d.type !== "file") reject(new ShownError(`"${d.name.slice(FILES_PREFIX.length)}" in your files folder changed while it was being backed up. Back up again.`));
      });
    });
    archive.pipe(out);
    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_NAME });
    archive.file(dbCopy, { name: DB_ENTRY });
    for (const f of found) archive.file(f.abs, { name: FILES_PREFIX + f.name });
    try {
      await Promise.all([archive.finalize(), written]);
    } catch (e) {
      archive.abort();
      out.destroy();
      if (!out.closed) await once(out, "close").catch(() => {}); // release the fd before the zip is deleted (Windows refuses to delete an open file)
      throw e;
    }

    const sizeBytes = (await stat(/*turbopackIgnore: true*/ path)).size;
    await recordBackup(now);
    return { ok: true, path, sizeBytes, fileCount: found.length, filesBytes, filesRoot: root, createdAt: manifest.createdAt };
  } catch (e) {
    if (zipPath) await rm(zipPath, { force: true }).catch(() => {});
    return fail(explain(e, rootReal));
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
