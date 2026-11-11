// Server-only. All live files of one application as a single zip (FR-5.10), streamed: at most one file (<= MAX_UPLOAD_BYTES) is in memory.
// Entries are flat, named by the stored name from the database row (the application's files all sit in one folder, so the names are unique);
// tombstones (8.8) are not listed. Paths and bytes come from verifyStoredFile (8.6): the file is opened through resolveInRoot, hashed, and
// THOSE bytes are what is added, and the result is recorded in files.integrity like Open does. Entry mode 0644 (the stored files are 0444,
// which would make extraction awkward).
// planApplicationZip is the check before anything is sent, also with ?anyway=1: it verifies every file once (the bytes are dropped), so a
// changed or missing file can be answered with a page instead of a download, an unset files folder is a 409, and a zip that would come out
// empty (every file missing, unreadable or too large) is refused instead of sent. That is a deliberate double read: the zip stream verifies
// again as it adds each file and adds the bytes it just hashed. A file that changes between the plan and the stream (milliseconds) is zipped
// as it is then; its mismatch is still recorded in files.integrity and shows on the detail page. With ?anyway=1 changed files are included
// as they are on disk; missing, unreadable and too-large (bigger than any upload) ones are skipped. A failure after the response started
// (a zip error) aborts the stream, so the browser reports a failed download rather than a truncated zip that looks fine.
import { once } from "node:events";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { ZipArchive } from "archiver";
import { listApplicationFiles } from "../db/files";
import { verifyStoredFile } from "./open";

export type ZipProblem = { storedName: string; kind: "changed" | "missing" | "unreadable" | "too-large" };
// includable: how many files ?anyway=1 would put in the zip (ok or changed, small enough to read).
export type ZipPlan =
  | { ok: true; names: { id: number; storedName: string }[]; problems: ZipProblem[]; includable: number }
  | { ok: false; kind: "none" | "setup"; error: string };

export async function planApplicationZip(applicationId: number): Promise<ZipPlan> {
  const list = await listApplicationFiles(applicationId);
  if (list.length === 0) return { ok: false, kind: "none", error: "This application has no files to download." };
  const problems: ZipProblem[] = [];
  let includable = 0;
  for (const f of list) {
    const r = await verifyStoredFile(f.id);
    if (!r.ok && r.kind === "setup") return { ok: false, kind: "setup", error: r.error };
    if (!r.ok) { if (r.kind !== "deleted") problems.push({ storedName: f.storedName, kind: r.kind === "missing" ? "missing" : "unreadable" }); continue; }
    if (!r.bytes) { problems.push({ storedName: f.storedName, kind: "too-large" }); continue; }
    includable++;
    if (r.integrity === "mismatch") problems.push({ storedName: f.storedName, kind: "changed" });
  }
  return { ok: true, names: list.map((f) => ({ id: f.id, storedName: f.storedName })), problems, includable };
}

export function applicationZipStream(names: { id: number; storedName: string }[]): ReadableStream<Uint8Array> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const closed = once(archive, "close");
  closed.catch(() => {}); // an archive error rejects it too; that is handled below
  void (async () => {
    try {
      for (const f of names) {
        const r = await verifyStoredFile(f.id);
        if (archive.destroyed) return; // the client went away
        if (!r.ok || !r.bytes) continue; // missing, deleted meanwhile or unreadable: skipped; too large to read: skipped
        const added = once(archive, "entry"); // wait for the entry so the next file is read only when this one has been taken (backpressure)
        archive.append(r.bytes, { name: r.storedName, mode: 0o644 });
        await Promise.race([added, closed]);
      }
      await archive.finalize();
    } catch (e) {
      archive.destroy(e as Error);
    }
  })();
  return Readable.toWeb(archive) as NodeWebStream<Uint8Array> as ReadableStream<Uint8Array>;
}
