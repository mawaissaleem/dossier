// Server-only. Opens a stored file for reading (5.10) and verifies it (8.6, FR-5.5): the row is looked up by id and user, its relative path
// goes through resolveInRoot, the file is opened ONCE and read whole into memory, and the SHA-256 is taken of those same bytes. What is
// checked is exactly what is served (no swap or in-place edit between check and serve). Memory is bounded because uploads are capped at
// MAX_UPLOAD_BYTES; a file on disk larger than that is a mismatch without being read. This is the one read of stored bytes.
// verifyStoredFile is also the "verify one file" step for 8.7's on-demand check: it records the result in files.integrity.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { getFileForOpen, recordIntegrity } from "../db/files";
import { getFilesRoot } from "../db/settings";
import { MAX_UPLOAD_BYTES } from "../upload-form";
import { resolveInRoot } from "./resolve";

type Failure = "not-found" | "deleted" | "setup" | "refused" | "missing" | "error";
// ok/mismatch: the file exists; bytes are null only when it is too large to read (never for ok). found is null in that case too.
export type VerifyResult =
  | { ok: true; integrity: "ok" | "mismatch"; storedName: string; expected: string; found: string | null; bytes: Buffer | null }
  | { ok: false; kind: Failure; error: string };

const fail = (kind: Failure, error: string) => ({ ok: false, kind, error }) as const;

export async function verifyStoredFile(id: number): Promise<VerifyResult> {
  const row = await getFileForOpen(id);
  if (!row) return fail("not-found", "File not found.");
  if (row.deleted) return fail("deleted", "This file was deleted. Only its record is kept in the submissions that listed it.");
  const root = await getFilesRoot();
  if (!root) return fail("setup", "Choose the files folder in Settings before opening files.");
  const target = await resolveInRoot(root, row.relativePath);
  if (!target.ok) return fail("refused", "This file cannot be opened: its stored path is not allowed.");
  let handle;
  try {
    handle = await open(target.path, "r");
    const st = await handle.stat();
    if (!st.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
    const big = st.size > MAX_UPLOAD_BYTES;
    const bytes = big ? null : await handle.readFile();
    const found = bytes && createHash("sha256").update(bytes).digest("hex");
    const integrity = found === row.sha256 ? "ok" : "mismatch";
    await recordIntegrity(id, integrity);
    return { ok: true, integrity, storedName: row.storedName, expected: row.sha256, found, bytes };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      // The answer is true whether or not it could be recorded (e.g. database locked): never turn it into an unhandled 500.
      await recordIntegrity(id, "missing").catch((err) => console.error("Could not record missing state", err));
      return fail("missing", `The file ${row.storedName} is missing from the files folder. It may have been moved or deleted outside Dossier.`);
    }
    console.error("Open failed", e);
    return fail("error", "Could not read the file.");
  } finally {
    await handle?.close().catch(() => {});
  }
}
