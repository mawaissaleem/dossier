// Server-only. Opens a stored file for reading (5.10): the row is looked up by id and user, its relative path goes through
// resolveInRoot, and the bytes are streamed. This is the one read of stored bytes; hash verification (8.6) hooks in here.
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { getFileForOpen } from "../db/files";
import { getFilesRoot } from "../db/settings";
import { resolveInRoot } from "./resolve";

// not-found = no such row (or not this user's), setup = files folder unset, refused = the stored path is not allowed, missing = row without a file on disk.
export type OpenResult =
  | { ok: true; storedName: string; sizeBytes: number; stream: ReadableStream<Uint8Array> }
  | { ok: false; kind: "not-found" | "setup" | "refused" | "missing" | "error"; error: string };

const fail = (kind: "not-found" | "setup" | "refused" | "missing" | "error", error: string) => ({ ok: false, kind, error }) as const;

export async function openStoredFile(id: number): Promise<OpenResult> {
  const row = await getFileForOpen(id);
  if (!row) return fail("not-found", "File not found.");
  const root = await getFilesRoot();
  if (!root) return fail("setup", "Choose the files folder in Settings before opening files.");
  const target = await resolveInRoot(root, row.relativePath);
  if (!target.ok) return fail("refused", "This file cannot be opened: its stored path is not allowed.");
  let handle;
  try {
    handle = await open(target.path, "r");
    const st = await handle.stat();
    if (!st.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
    // The stream closes the handle when it ends or is cancelled.
    return { ok: true, storedName: row.storedName, sizeBytes: st.size, stream: Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array> };
  } catch (e) {
    await handle?.close().catch(() => {});
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return fail("missing", `The file ${row.storedName} is missing from the files folder. It may have been moved or deleted outside Dossier.`);
    console.error("Open failed", e);
    return fail("error", "Could not read the file.");
  }
}
