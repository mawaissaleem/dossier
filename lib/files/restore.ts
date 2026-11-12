// Server-only. "Restore from a backup" (FR-12.3, NFR-5, AT-13). Layout, entry rules and limits: lib/backup.ts, lib/restore.ts.
//
// readBackup (also the "Check backup" step) changes nothing that exists: it reads the zip and judges it
//   1. the path (a full path to a regular file, not inside the files folder: a restore replaces that folder and would delete the zip)
//   2. the entry list from the central directory (checkListing), the manifest (format and version), then the database copy unpacked
//      and opened read-only (integrity, tables, schema not newer than this app, its file rows with safe paths)
//   3. every file the database lists is looked up in the zip and hashed. One that is absent or whose bytes differ from the recorded SHA-256
//      does NOT refuse the backup: since 8.6/8.7 a changed or missing file is a normal, flagged state of the app, and Back up now copies
//      what is on disk, so refusing would make every backup of that state unrestorable (NFR-5). Such files are listed in the result
//      (`changed`, `missing`, shown in the check and the confirm), a changed one is restored as it is, and the restored rows are flagged
//      'mismatch' / 'missing' (finalizeStagedDb), exactly as Open would find them. Files in the zip the database does not list (stray files
//      in the folder when the backup was made) are restored as they were and counted in the check; nothing records a hash for them.
//      Structural problems still refuse: the entry rules, the manifest, the database's integrity, a newer schema, unsafe paths.
//   4. the manifest's file count and size match the zip, and there is room on disk for what will be unpacked
// With `files.out` it also unpacks every file into a staging folder (mode 0444 as stored files are), hashing as it writes.
//
// restoreFromBackup (the only place that replaces anything), in this order:
//   a. readBackup into staging: the database next to the live file, the files inside the files folder (same file systems, so the
//      swap is renames). The live data is untouched. Any refusal or failure here removes the staging and stops.
//   b. the data counts the dialog showed must still match (else refuse: "check again")
//   c. SAFETY BACKUP of the current state with createBackup into the saved backup folder. No saved folder, or the backup fails: stop,
//      nothing changed. (Its path is in the result.)
//   d. finalize the staged database (migrate an older backup, put this computer's settings back, flag changed/missing files, re-check)
//   e. swap the files (only when the backup holds files), then the database; verify the restored counts; any failure rolls both back
//   f. the old database and the old files are deleted; a failure only becomes a warning (the restore already worked)
// Files swap: a files folder can be a mount point or a user's own folder, so it is not renamed. Its CONTENTS move into a hidden
// sibling folder inside it, then the staged contents move up. When the backup holds no files the files folder is left as it is.
// Limits: a crash (power loss, kill) mid-swap leaves `.dossier-restore-*` leftovers in the files folder and next to the database,
// and the old data may sit in them; nothing sweeps those. Backups skip top-level `.dossier-restore-*` folders in the files folder, so
// the safety backup holds the live files only (not the staged copy). A restore does not stop other requests: one that lands in the
// few milliseconds of the swap can fail once. Symlinks and empty folders in the files folder are not in a backup and are removed with it.
// turbopackIgnore on fs calls that take user-typed paths: without it Next warns that the build traces the whole project.
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, realpath, rename, rm, rmdir, stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openPromise, type Entry, type ZipFile } from "yauzl";
import { DB_ENTRY, FILES_PREFIX, MANIFEST_NAME, parseManifest } from "../backup";
import { getBackupDestination } from "../db/backup";
import { currentCounts, finalizeStagedDb, inspectBackupDb, type FileFlags, removeStaged, stagedDatabasePath, swapDatabase } from "../db/restore";
import { getFilesRoot } from "../db/settings";
import { checkListing, LIMITS, parseExpected, sameCounts, STAGE_PREFIX, type Counts, type ZipEntryInfo } from "../restore";
import { createBackup } from "./backup";
import { isFullyAbsolute } from "./relative";
import { isInside, validateFilesRoot } from "./root";

// `changed` / `missing`: relative paths of files the backup's database lists whose bytes differ from the record / that are not in the zip.
export type BackupInfo = { createdAt: string; counts: Counts; fileCount: number; filesBytes: number; extraFiles: number; schemaOlder: boolean; changed: string[]; missing: string[] };
export type CheckResult = { ok: true; info: BackupInfo } | { ok: false; error: string };
export type RestoreResult = { ok: true; safetyBackupPath: string; createdAt: string; counts: Counts; warnings: string[] } | { ok: false; error: string };

class ShownError extends Error {} // its message is already written for the user
const refuse = (message: string): never => { throw new ShownError(message); };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const SPACE_SLACK = 16 * 1024 ** 2; // room for the database to grow while it is migrated
const stageName = () => `${STAGE_PREFIX}${randomBytes(6).toString("hex")}`;

async function checkZipPath(input: unknown): Promise<string> {
  const typed = typeof input === "string" ? input.trim() : "";
  if (typed === "") return refuse("Enter the full path of the backup zip.");
  if (typed.includes("\0") || !isFullyAbsolute(typed)) return refuse("Use the full path of the zip, such as /home/you/Backups/dossier-backup-20261110-1432.zip. Relative paths and ~ are not accepted.");
  let real: string;
  try {
    real = await realpath(/*turbopackIgnore: true*/ typed);
    if (!(await stat(/*turbopackIgnore: true*/ real)).isFile()) return refuse("That path is not a file.");
  } catch (e) {
    if (e instanceof ShownError) throw e;
    return refuse("No file exists at that path.");
  }
  const root = await getFilesRoot();
  const rootReal = root ? await realpath(/*turbopackIgnore: true*/ root).catch(() => null) : null;
  if (rootReal && isInside(real, rootReal)) return refuse("This backup is inside your files folder, which a restore replaces. Move the zip somewhere else first.");
  return real;
}

const entryInfo = (e: Entry): ZipEntryInfo => {
  const raw = e.fileNameRaw;
  const name = raw.toString("utf8");
  // Names are UTF-8. A name with other bytes and no UTF-8 flag is legacy CP437: its meaning is ambiguous, so it is refused.
  if (name.includes("�") || (raw.some((b) => b > 0x7f) && !(e.generalPurposeBitFlag & 0x800))) refuse("The backup has an entry whose name Dossier cannot read.");
  return { name, flags: e.generalPurposeBitFlag, method: e.compressionMethod, compressedSize: e.compressedSize, uncompressedSize: e.uncompressedSize, versionMadeBy: e.versionMadeBy, externalAttributes: e.externalFileAttributes };
};

// Streams one entry through a SHA-256 and into `out` (created exclusively, so nothing is overwritten) or nowhere. yauzl errors the stream
// if the real size differs from the declared one.
async function pump(zip: ZipFile, entry: Entry, out: string | null, mode: number): Promise<string> {
  const hash = createHash("sha256");
  const tap = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); cb(null, chunk); } });
  const sink = out ? createWriteStream(out, { flags: "wx", mode }) : new Writable({ write: (_c, _e, cb) => cb() });
  await pipeline(await zip.openReadStreamPromise(entry), tap, sink);
  return hash.digest("hex");
}

async function readSmall(zip: ZipFile, entry: Entry, max: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const chunk of await zip.openReadStreamPromise(entry)) {
    n += (chunk as Buffer).length;
    if (n > max) return refuse("The backup manifest is too large.");
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

// Free space per file system (folders on one drive share it). Skipped where the platform cannot say.
async function checkSpace(needs: { dir: string; bytes: number }[]): Promise<void> {
  const byDevice = new Map<number, { dir: string; bytes: number }>();
  for (const n of needs) {
    const dev = (await stat(/*turbopackIgnore: true*/ n.dir)).dev;
    const prev = byDevice.get(dev);
    byDevice.set(dev, { dir: n.dir, bytes: (prev?.bytes ?? 0) + n.bytes });
  }
  for (const { dir, bytes } of byDevice.values()) {
    const fs = await statfs(/*turbopackIgnore: true*/ dir).catch(() => null);
    if (fs && bytes > fs.bavail * fs.bsize) refuse(`There is not enough free disk space to unpack this backup next to ${dir}: it needs about ${Math.ceil(bytes / 1024 ** 2)} MB.`);
  }
}

type FilesTarget = { out: string } | { refuse: string };
type Read = { info: BackupInfo; counts: Counts; flags: FileFlags };

// `dbOut`: where the database copy is unpacked (a path that does not exist yet, in a folder that does). `files`: absent = only
// hash the files (the check); `out` = unpack them into that (not yet existing) folder; `refuse` = the message to give if the backup has files.
async function readBackup(zipPathInput: unknown, dbOut: string, files?: FilesTarget): Promise<Read> {
  const path = await checkZipPath(zipPathInput);
  let zip: ZipFile;
  try {
    zip = await openPromise(/*turbopackIgnore: true*/ path, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true });
  } catch {
    return refuse("That file is not a readable zip. It may be damaged or incomplete.");
  }
  try {
    if (zip.entryCount > LIMITS.maxEntries) return refuse(`This backup holds too many entries (${zip.entryCount}).`);
    const byName = new Map<string, Entry>();
    const infos: ZipEntryInfo[] = [];
    try {
      for await (const e of zip.eachEntry()) {
        const info = entryInfo(e);
        infos.push(info);
        byName.set(info.name.endsWith("/") ? info.name.slice(0, -1) : info.name, e);
      }
    } catch (e) {
      if (e instanceof ShownError) throw e;
      return refuse("That file is not a readable zip. It may be damaged or incomplete.");
    }
    const listing = checkListing(infos);
    if (!listing.ok) return refuse(listing.error);

    const manifest = parseManifest(safeJson(await readSmall(zip, byName.get(MANIFEST_NAME)!, LIMITS.maxManifestBytes)));
    if (!manifest.ok) return refuse(manifest.error);
    const filesBytes = [...listing.files.values()].reduce((s, n) => s + n, 0);
    if (manifest.manifest.fileCount !== listing.files.size || manifest.manifest.filesBytes !== filesBytes) {
      return refuse("The backup's file list does not match its manifest, so it is incomplete or was changed. It was not restored.");
    }
    if (files && listing.files.size > 0 && "refuse" in files) return refuse(files.refuse);

    await checkSpace([
      { dir: dirname(dbOut), bytes: listing.dbBytes + SPACE_SLACK },
      ...(files && "out" in files ? [{ dir: dirname(files.out), bytes: filesBytes }] : []),
    ]);

    await pump(zip, byName.get(DB_ENTRY)!, dbOut, 0o600);
    const db = inspectBackupDb(dbOut);
    if (!db.ok) return refuse(db.error);

    const listed = new Set(db.info.filePaths.map((r) => r.relativePath));

    const outDir = files && "out" in files ? files.out : null;
    const unpack = async (rel: string) => {
      const out = outDir ? join(outDir, ...rel.split("/")) : null;
      if (out && !isInside(out, outDir!)) return refuse("The backup has a file path that leaves its folder."); // checkListing already refuses these
      if (out) await mkdir(dirname(out), { recursive: true });
      const sha = await pump(zip, byName.get(FILES_PREFIX + rel)!, out, 0o600);
      if (out) await chmod(out, 0o444); // stored files are read-only (FR-5.5); the zip's own modes are never applied
      return sha;
    };
    const flags: FileFlags = { ok: [], changed: [], missing: [] };
    for (const r of db.info.filePaths) {
      if (!listing.files.has(r.relativePath)) flags.missing.push(r.relativePath);
      else flags[(await unpack(r.relativePath)) === r.sha256 ? "ok" : "changed"].push(r.relativePath);
    }
    const extras = [...listing.files.keys()].filter((p) => !listed.has(p));
    if (outDir) for (const rel of extras) await unpack(rel);

    const info = { createdAt: manifest.manifest.createdAt, counts: db.info.counts, fileCount: listing.files.size, filesBytes, extraFiles: extras.length, schemaOlder: db.info.schemaOlder, changed: flags.changed, missing: flags.missing };
    return { info, counts: db.info.counts, flags };
  } finally {
    zip.close();
  }
}

function safeJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

const explain = (e: unknown) => (e instanceof ShownError ? e.message : `The restore failed: ${(e as Error).message}`);

// The "Check backup" step: nothing is changed. The database copy is unpacked in the system temp folder and removed.
export async function checkBackup(zipPath: unknown): Promise<CheckResult> {
  let tmp: string | undefined;
  try {
    tmp = await mkdtemp(join(tmpdir(), "dossier-check-"));
    return { ok: true, info: (await readBackup(zipPath, join(tmp, "dossier.db"))).info };
  } catch (e) {
    return fail(explain(e));
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export type FilesSwap = { undo(): Promise<void>; discard(): Promise<void>; aside: string };

// Moves the files folder's contents aside and the staged contents in. Exported for tests (a failing rename).
export async function swapFiles(root: string, stage: string): Promise<FilesSwap> {
  const aside = join(root, stageName());
  const toAside: string[] = [];
  const placed: string[] = [];
  const undo = async () => {
    for (const n of placed.reverse()) await rename(join(root, n), join(stage, n));
    for (const n of toAside.reverse()) await rename(join(aside, n), join(root, n));
    await rmdir(aside).catch(() => {}); // empty now; the files are back either way, so a leftover folder is not a failure
  };
  try {
    await mkdir(aside);
    for (const n of await readdir(root)) {
      if (join(root, n) === stage || join(root, n) === aside) continue;
      await rename(join(root, n), join(aside, n));
      toAside.push(n);
    }
    for (const n of await readdir(stage)) {
      await rename(join(stage, n), join(root, n));
      placed.push(n);
    }
  } catch (e) {
    await undo().catch(() => refuse(`The restore failed and the files folder could not be put back. Your previous files are in ${aside}.`));
    throw e;
  }
  return { undo, aside, discard: () => rm(aside, { recursive: true, force: true }) };
}

export async function restoreFromBackup(zipPath: unknown, expectedInput: unknown): Promise<RestoreResult> {
  const expected = parseExpected(expectedInput);
  if (!expected) return fail("Check the backup again, then restore.");
  const destination = await getBackupDestination();
  if (!destination) return fail("Save a backup folder in the Backup section first. Dossier saves a safety backup of your current data there before it replaces anything.");

  const root = await getFilesRoot();
  const rootCheck = root ? await validateFilesRoot(root) : null;
  const rootPath = rootCheck?.ok ? rootCheck.path : null;
  const files: FilesTarget = rootPath
    ? { out: join(rootPath, stageName()) }
    : { refuse: rootCheck && !rootCheck.ok ? `The files folder cannot be used: ${rootCheck.error} Fix it in Settings, then restore.` : "This backup holds files, but no files folder is set. Choose the files folder in Settings first, then restore." };

  const stagedDb = stagedDatabasePath();
  const stageDir = "out" in files ? files.out : null;
  let filesSwap: FilesSwap | undefined;
  let dbSwap: ReturnType<typeof swapDatabase> | undefined;
  try {
    const read = await readBackup(zipPath, stagedDb, files);
    if (read.info.createdAt !== expected.createdAt) return fail("The backup file changed since it was checked. Check it again.");
    if (!sameCounts(currentCounts(), expected.counts)) return fail("Your data changed since the confirmation was shown. Nothing was restored. Check again.");

    const safety = await createBackup(destination);
    if (!safety.ok) return fail(`Nothing was changed: the safety backup of your current data failed. ${safety.error}`);

    finalizeStagedDb(stagedDb, read.flags);
    try {
      if (read.info.fileCount > 0) filesSwap = await swapFiles(rootPath!, stageDir!); // the backup has files, so a usable root was required above
      dbSwap = swapDatabase(stagedDb);
      if (!sameCounts(currentCounts(), read.counts)) throw new Error("the restored data did not match the backup");
    } catch (e) {
      const stuck: string[] = [];
      try { dbSwap?.undo(); } catch { stuck.push("the database"); }
      try { await filesSwap?.undo(); } catch { stuck.push("the files folder"); }
      if (stuck.length) return fail(`The restore failed and ${stuck.join(" and ")} could not be put back. Restore the safety backup ${safety.path} by hand. (${(e as Error).message})`);
      throw e;
    }

    const warnings: string[] = [];
    try { dbSwap!.discard(); } catch { warnings.push("The old database copy could not be deleted."); }
    try { await filesSwap?.discard(); } catch { warnings.push(`The old files could not all be deleted; they are in ${filesSwap?.aside}. They are also in the safety backup.`); }
    return { ok: true, safetyBackupPath: safety.path, createdAt: read.info.createdAt, counts: read.counts, warnings };
  } catch (e) {
    return fail(explain(e) + (e instanceof ShownError ? "" : " Your previous data is unchanged."));
  } finally {
    removeStaged(stagedDb);
    if (stageDir) await rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}
