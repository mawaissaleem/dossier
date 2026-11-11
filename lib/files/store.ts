// Server-only. Stores one uploaded file (5.7): the bytes go to a temp file inside the application folder while the SHA-256 is computed,
// the stored name gets the next counter, the file is hard-linked into place (link fails if the name exists, so nothing is ever
// overwritten; where hard links are unsupported it is copied with COPYFILE_EXCL instead), made read-only, and only then the row is
// inserted. Order and cleanup:
//  1. temp write  2. link (or copy) to the final name  3. remove the temp name  4. chmod 0o444  5. insert row.
//  3 comes before 4 because on Windows removing a second name of a read-only file clears the read-only attribute of the shared file.
//  A failure in 3-5 removes the final file, so a failed upload leaves no row without a file and no file without a row. The temp
//  file is always removed. A first upload that fails also removes the folder it created (rmdir only removes an empty folder).
//  Duplicates (FR-5.7): after hashing, a file of the SAME application with the same SHA-256 means nothing is stored: the temp file is
//  removed, and so is a folder this call created. The result is { ok: true, duplicateOf } instead of { ok: true, file }.
//  Limit: a crash (power loss, kill) between 2 and 5 can leave a file with no row or a .upload-*.tmp file; nothing sweeps those yet.
// Two uploads can race for the same counter: a taken name (EEXIST) or a unique-index violation moves on to the next seq.
import { createHash, randomBytes } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { chmod, copyFile, link, rename, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { isForeignKeyViolation, isUniqueViolation } from "../db/errors";
import { findFileByHash, getApplicationFolder, getCounterEntries, insertFileRow } from "../db/files";
import { getFilesRoot } from "../db/settings";
import { buildStoredName, type CounterEntry } from "../filename";
import { ensureApplicationFolder } from "./folder";
import { beginUpload, MOVING_MESSAGE } from "./lock";
import { toRelativePath } from "./relative";
import { resolveInRoot } from "./resolve";

export type UploadSource = { name: string; stream(): unknown }; // a web File
export type StoredFile = { id: number; storedName: string; relativePath: string; sizeBytes: number; sha256: string };
// setup = the files folder is unset or unusable (Settings), not-found = the application is gone, error = anything else.
export type StoreResult = { ok: true; file: StoredFile } | { ok: true; duplicateOf: { id: number; storedName: string } } | { ok: false; kind: "setup" | "not-found" | "error"; error: string };

const MAX_TRIES = 1000;
const fail = (kind: "setup" | "not-found" | "error", error: string) => ({ ok: false, kind, error }) as const;
const code = (e: unknown) => (e as NodeJS.ErrnoException).code;
// A read-only file cannot be removed on Windows, so make it writable first (a no-op error elsewhere is ignored).
const removeFile = async (p: string) => { await chmod(p, 0o666).catch(() => {}); await rm(p, { force: true }).catch(() => {}); };
// FAT/exFAT drives and some network or sync mounts have no hard links: copy instead. COPYFILE_EXCL also refuses to overwrite (EEXIST),
// and libuv removes a partly written copy itself.
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);
const putInPlace = (from: string, to: string) =>
  link(from, to).catch((e) => (NO_HARD_LINKS.has(code(e)!) ? copyFile(from, to, constants.COPYFILE_EXCL) : Promise.reject(e)));

// shortcut: in-process only (one server, one user); a second server process on the same files root is not serialised, upgrade then.
const tails = new Map<number, Promise<unknown>>();
function serialise<T>(applicationId: number, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(applicationId) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {}).then(() => { if (tails.get(applicationId) === tail) tails.delete(applicationId); });
  tails.set(applicationId, tail);
  return run;
}

// Uploads for one application run one at a time: otherwise two concurrent FIRST uploads would each create a folder.
// While the files root is being moved or changed (8.10) uploads are refused, and a move waits for running uploads: see lock.ts.
export async function storeUploadedFile(input: StoreInput): Promise<StoreResult> {
  const end = beginUpload();
  if (!end) return fail("error", MOVING_MESSAGE);
  try {
    return await serialise(input.applicationId, () => storeFileUnlocked(input));
  } finally {
    end();
  }
}

export type StoreInput = { applicationId: number; file: UploadSource; label: string; uploadDate: string };

// Exported for tests (the counter race without the per-application queue). Call storeUploadedFile.
export async function storeFileUnlocked({ applicationId, file, label, uploadDate }: StoreInput): Promise<StoreResult> {
  const hadFolder = (await getApplicationFolder(applicationId)) !== null;
  const folder = await ensureApplicationFolder(applicationId, uploadDate);
  if (!folder.ok) return fail("setup", folder.error);
  const tmp = join(folder.absolutePath, `.upload-${randomBytes(8).toString("hex")}.tmp`);
  let result: StoreResult;
  try {
    result = await place(applicationId, file, label, uploadDate, folder.relativePath, tmp);
  } catch (e) {
    console.error("Upload failed", e);
    result = fail("error", "Could not store the file. Nothing was saved.");
  }
  await removeFile(tmp);
  if (!("file" in result) && !hadFolder) await rmdir(folder.absolutePath).catch(() => {});
  return result;
}

async function place(applicationId: number, file: UploadSource, label: string, uploadDate: string, folderRel: string, tmp: string): Promise<StoreResult> {
  const root = await getFilesRoot();
  if (!root) return fail("setup", "Choose the files folder in Settings before uploading.");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  await pipeline(
    Readable.fromWeb(file.stream() as NodeWebStream),
    async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) { hash.update(chunk); sizeBytes += chunk.length; yield chunk; }
    },
    createWriteStream(tmp, { flags: "wx", mode: 0o600 }),
  );
  const sha256 = hash.digest("hex");
  const same = await findFileByHash(applicationId, sha256); // inside the per-application queue, so a file stored a moment ago is seen
  if (same) return { ok: true, duplicateOf: same };

  const taken: CounterEntry[] = []; // names that lost a race, so the next try moves past them
  for (let i = 0; i < MAX_TRIES; i++) {
    const name = buildStoredName(file.name, uploadDate, [...(await getCounterEntries(applicationId)), ...taken]);
    const target = await resolveInRoot(root, `${folderRel}/${name.storedName}`);
    if (!target.ok) return fail("setup", target.error);
    const rel = toRelativePath(root, target.path);
    if (!rel.ok) return fail("error", rel.error);
    try {
      await putInPlace(tmp, target.path); // fails if the name exists: never overwrites
    } catch (e) {
      if (code(e) !== "EEXIST") throw e;
      taken.push(name);
      continue;
    }
    try {
      await rm(tmp); // before the chmod (see the header)
      await chmod(target.path, 0o444);
      const id = await insertFileRow({
        applicationId, label, originalName: file.name, storedName: name.storedName, relativePath: rel.path, sha256, sizeBytes,
        uploadDate, baseName: name.baseName, extension: name.extension, seq: name.seq,
      });
      return { ok: true, file: { id, storedName: name.storedName, relativePath: rel.path, sizeBytes, sha256 } };
    } catch (e) {
      // Another upload holds this name in the database: move the bytes back to the temp name (writable again) and try the next seq.
      if (isUniqueViolation(e) && (await chmod(target.path, 0o666).then(() => rename(target.path, tmp)).then(() => true, () => false))) {
        taken.push(name);
        continue;
      }
      await removeFile(target.path);
      if (isForeignKeyViolation(e)) return fail("not-found", "Application not found.");
      throw e;
    }
  }
  return fail("error", "Could not find a free file name.");
}
