import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/files/[id]/route";
import { backUpNow } from "@/app/actions/backup";
import { checkFiles, deleteFile, fetchFileDeleteImpact } from "@/app/actions/files";
import { addSubmission } from "@/app/actions/submissions";
import { createApplication, getDeleteImpact } from "@/lib/db/applications";
import { getDb } from "@/lib/db/client";
import { listActivity } from "@/lib/db/activity";
import { findFileByHash, getFileDeleteImpact, listApplicationFiles } from "@/lib/db/files";
import * as dbRestore from "@/lib/db/restore";
import { activityEvents, files, tracks } from "@/lib/db/schema";
import { setBackupDestination } from "@/lib/db/backup";
import { setFilesRoot } from "@/lib/db/settings";
import { listSubmissions } from "@/lib/db/submissions";
import { createBackup } from "@/lib/files/backup";
import { deleteApplicationWithFiles } from "@/lib/files/remove";
import { restoreFromBackup } from "@/lib/files/restore";
import { storeUploadedFile } from "@/lib/files/store";
import { eventLine } from "@/lib/history";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;
const posix = process.platform !== "win32";
const canBlockUnlink = posix && process.getuid?.() !== 0; // a read-only folder blocks unlink, except for root

async function mkApp(title = "Acme") {
  const r = await createApplication({ title, trackId: db.select().from(tracks).all()[0].id, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function store(name: string, content: string, app = appId) {
  const r = await storeUploadedFile({ applicationId: app, file: new File([content], name), label: "CV", uploadDate: "2026-11-08" });
  if (!r.ok || !("file" in r)) throw new Error(JSON.stringify(r));
  return r.file;
}
const submit = async (ids: number[], date = "2026-11-09") => expect(await addSubmission(appId, ids, date, null, null)).toEqual({ ok: true });
// Delete the way the dialog does: read the impact, then confirm with the count it showed.
async function del(id: number) {
  const i = await fetchFileDeleteImpact(id);
  if (!i.ok) return deleteFile(id, true, 0);
  return deleteFile(id, true, i.submissions.length);
}
const get = (id: number) => GET(new NextRequest(`http://localhost:3000/api/files/${id}`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(id) }) } as never);
const row = (id: number) => getDb().select().from(files).all().find((f) => f.id === id);

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-fdel-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  appId = await mkApp();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("a file in no submission", () => {
  it("is removed from disk and its row deleted, read-only file included; History says so", async () => {
    const f = await store("CV.pdf", "v1");
    const abs = join(root, f.relativePath);
    if (posix) expect(statSync(abs).mode & 0o222).toBe(0); // stored read-only
    expect(await fetchFileDeleteImpact(f.id)).toMatchObject({ ok: true, originalName: "CV.pdf", storedName: f.storedName, label: "CV", sizeBytes: 2, submissions: [] });

    expect(await deleteFile(f.id, true, 0)).toEqual({ ok: true, kept: false });
    expect(existsSync(abs)).toBe(false);
    expect(row(f.id)).toBeUndefined();
    expect(await listApplicationFiles(appId)).toEqual([]);
    const ev = (await listActivity(appId))[0];
    expect(ev).toMatchObject({ kind: "file_deleted", fileId: null, details: { kind: "file_deleted", fileId: f.id, originalName: "CV.pdf", storedName: f.storedName, label: "CV", submissionCount: 0 } });
    expect(eventLine(ev.kind, ev.details)).toBe(`Deleted CV.pdf (${f.storedName}, CV)`);
    expect((await get(f.id)).status).toBe(404);
  });

  it("keeps its counter reserved after the row is gone, and the same bytes can be uploaded again (no duplicate)", async () => {
    const f = await store("CV.pdf", "v1");
    expect(f.storedName).toBe("01-20261108-CV.pdf");
    await del(f.id);
    expect(row(f.id)).toBeUndefined();
    expect(await findFileByHash(appId, f.sha256)).toBeNull();
    const again = await store("CV.pdf", "v1");
    expect(again.storedName).toBe("02-20261108-CV.pdf"); // 01 stays the deleted file's name in History and older backups
    await del(again.id);
    expect((await store("CV.pdf", "v2")).storedName).toBe("03-20261108-CV.pdf");
    expect((await store("Other.pdf", "o")).storedName).toBe("01-20261108-Other.pdf"); // only the same name is affected
  });

  it("deleting the last file removes its now-empty folder; a file dropped in by hand keeps the folder; the next upload gets a clean folder", async () => {
    const f = await store("CV.pdf", "v1");
    await del(f.id);
    expect(readdirSync(root)).toEqual([]);
    const g = await store("Letter.txt", "x");
    expect(readdirSync(root)).toEqual(["Acme_2026-11"]);
    writeFileSync(join(root, g.relativePath, "..", "by-hand.txt"), "mine");
    await del(g.id);
    expect(readdirSync(join(root, "Acme_2026-11"))).toEqual(["by-hand.txt"]);
  });
});

describe("a file in a submission", () => {
  it("is tombstoned: bytes gone, row kept as the submission's record, Open refuses with 410", async () => {
    const f = await store("CV.pdf", "v1");
    await submit([f.id]);
    expect(await fetchFileDeleteImpact(f.id)).toMatchObject({ ok: true, submissions: [{ date: "2026-11-09" }] });

    expect(await deleteFile(f.id, true, 1)).toEqual({ ok: true, kept: true });
    expect(existsSync(join(root, f.relativePath))).toBe(false);
    const r = row(f.id)!;
    expect(r).toMatchObject({ originalName: "CV.pdf", storedName: f.storedName, label: "CV", sizeBytes: 2, sha256: f.sha256 });
    expect(r.deletedAt).toBeInstanceOf(Date);

    const [s] = await listSubmissions(appId);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ id: f.id, originalName: "CV.pdf", label: "CV", sizeBytes: 2, sha256: f.sha256 });
    expect(s.files[0].deletedAt).toBeInstanceOf(Date);
    expect(await listApplicationFiles(appId)).toEqual([]);
    const res = await get(f.id);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/deleted/) });
    expect(await fetchFileDeleteImpact(f.id)).toMatchObject({ ok: false });

    const ev = (await listActivity(appId))[0];
    expect(ev).toMatchObject({ kind: "file_deleted", fileId: f.id, details: { submissionCount: 1 } });
    expect(eventLine(ev.kind, ev.details)).toMatch(/1 submission keeps its name/);
  });

  it("a deleted file cannot join a new submission, and Check files skips it", async () => {
    const f = await store("CV.pdf", "v1");
    const keep = await store("Letter.txt", "dear");
    await submit([f.id]);
    await del(f.id);
    expect(await addSubmission(appId, [f.id], "2026-11-10", null, null)).toMatchObject({ ok: false });
    expect(await addSubmission(appId, [keep.id], "2026-11-10", null, null)).toEqual({ ok: true });
    expect(await checkFiles(appId)).toMatchObject({ ok: true, summary: "All 1 file OK" });
    expect(row(f.id)!.integrity).toBe("ok"); // not recorded as missing
  });

  it("keeps its counter and stored name reserved, and re-uploading the same bytes is stored as a new file", async () => {
    const f = await store("CV.pdf", "v1");
    await submit([f.id]);
    await del(f.id);
    const again = await store("CV.pdf", "v1");
    expect(again.storedName).toBe("02-20261108-CV.pdf");
    expect(again.id).not.toBe(f.id);
    expect(existsSync(join(root, again.relativePath))).toBe(true);
  });

  it("AT-10 still holds after the original CV is deleted: its submission lists it as deleted, a new submission takes the corrected CV", async () => {
    const v1 = await store("CV.pdf", "cv version 1");
    await submit([v1.id], "2026-11-08");
    const v2 = await store("CV.pdf", "cv version 2");
    await del(v1.id);
    await submit([v2.id], "2026-11-10");
    const [newer, older] = await listSubmissions(appId);
    expect(older.files.map((f) => [f.storedName, f.deletedAt !== null])).toEqual([["01-20261108-CV.pdf", true]]);
    expect(newer.files.map((f) => [f.storedName, f.deletedAt])).toEqual([["02-20261108-CV.pdf", null]]);
    expect(await (await get(v2.id)).text()).toBe("cv version 2");
  });
});

describe("refusals and edge cases", () => {
  it("a stale confirm is refused and changes nothing: the file joined a submission after the dialog opened", async () => {
    const f = await store("CV.pdf", "v1");
    const shown = await fetchFileDeleteImpact(f.id);
    expect(shown).toMatchObject({ ok: true, submissions: [] });
    await submit([f.id]);
    const r = await deleteFile(f.id, true, 0);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/changed since/) });
    expect(existsSync(join(root, f.relativePath))).toBe(true);
    expect(row(f.id)!.deletedAt).toBeNull();
    expect(await listApplicationFiles(appId)).toHaveLength(1);
  });

  it("the reverse is stale too: the dialog said 1 submission, there are 0 now", async () => {
    const f = await store("CV.pdf", "v1");
    expect(await deleteFile(f.id, true, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/changed since/) });
    expect(existsSync(join(root, f.relativePath))).toBe(true);
  });

  it("is refused without a literal true confirm, with a bad count or a bad id", async () => {
    const f = await store("CV.pdf", "v1");
    expect(await deleteFile(f.id, "yes" as never, 0)).toMatchObject({ ok: false });
    expect(await deleteFile(f.id, true, -1)).toMatchObject({ ok: false });
    expect(await deleteFile(f.id, true, 1.5)).toMatchObject({ ok: false });
    expect(await deleteFile(0, true, 0)).toMatchObject({ ok: false });
    expect(await deleteFile("1" as never, true, 0)).toMatchObject({ ok: false });
    expect(existsSync(join(root, f.relativePath))).toBe(true);
  });

  it("a file missing from disk can still be deleted (unsubmitted: row gone; submitted: tombstone)", async () => {
    const a = await store("A.pdf", "a");
    const b = await store("B.pdf", "b");
    await submit([b.id]);
    rmSync(join(root, a.relativePath), { force: true });
    rmSync(join(root, b.relativePath), { force: true });
    expect(await del(a.id)).toEqual({ ok: true, kept: false });
    expect(await del(b.id)).toEqual({ ok: true, kept: true });
    expect(row(a.id)).toBeUndefined();
    expect(row(b.id)!.deletedAt).not.toBeNull();
  });

  it("refuses another user's file and an unknown id", async () => {
    const f = await store("CV.pdf", "v1");
    getDb().$client.prepare("UPDATE files SET user_id = 'someone-else' WHERE id = ?").run(f.id);
    expect(await fetchFileDeleteImpact(f.id)).toMatchObject({ ok: false });
    expect(await deleteFile(f.id, true, 0)).toEqual({ ok: false, error: "File not found." });
    expect(await deleteFile(9999, true, 0)).toEqual({ ok: false, error: "File not found." });
    expect(existsSync(join(root, f.relativePath))).toBe(true);
    expect(row(f.id)!.deletedAt).toBeNull();
  });

  it("deleting twice: the second finds nothing", async () => {
    const f = await store("CV.pdf", "v1");
    await submit([f.id]);
    expect(await del(f.id)).toMatchObject({ ok: true });
    expect(await deleteFile(f.id, true, 1)).toEqual({ ok: false, error: "File not found." });
    expect((await listActivity(appId)).filter((e) => e.kind === "file_deleted")).toHaveLength(1);
  });

  it("a failed removal undoes the mark: the file stays live and nothing is logged", async () => {
    if (!canBlockUnlink) return;
    const f = await store("CV.pdf", "v1");
    const dir = join(root, f.relativePath, "..");
    chmodSync(dir, 0o555); // unlink needs write permission on the folder
    try {
      expect(await deleteFile(f.id, true, 0)).toMatchObject({ ok: false, error: expect.stringMatching(/could not be removed/) });
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(existsSync(join(root, f.relativePath))).toBe(true);
    expect(row(f.id)!.deletedAt).toBeNull();
    expect((await listActivity(appId)).filter((e) => e.kind === "file_deleted")).toEqual([]);
    expect(await deleteFile(f.id, true, 0)).toEqual({ ok: true, kept: false }); // and it can be retried
  });

  it("with no files folder set nothing is deleted", async () => {
    const f = await store("CV.pdf", "v1");
    getDb().$client.prepare("DELETE FROM settings WHERE key = 'files_root'").run();
    expect(await deleteFile(f.id, true, 0)).toMatchObject({ ok: false });
    expect(row(f.id)!.deletedAt).toBeNull();
  });

  it("does not follow a symlink put in the file's place", async () => {
    if (!posix) return;
    const f = await store("CV.pdf", "v1");
    const outside = join(base, "outside.txt");
    cpSync(join(root, f.relativePath), outside);
    const abs = join(root, f.relativePath);
    rmSync(abs);
    symlinkSync(outside, abs);
    expect(await deleteFile(f.id, true, 0)).toMatchObject({ ok: false });
    expect(existsSync(outside)).toBe(true);
    expect(row(f.id)!.deletedAt).toBeNull();
  });
});

describe("the rest of the app with a deleted file present", () => {
  it("deleting the application removes the tombstone too, with no 'missing' warning", async () => {
    const f = await store("CV.pdf", "v1");
    const g = await store("Letter.txt", "x");
    await submit([f.id, g.id]);
    await del(f.id);
    const i = (await getDeleteImpact(appId))!;
    expect(i.fileCount).toBe(1); // only the live file has bytes
    const r = await deleteApplicationWithFiles(appId, { cellCount: i.cellCount, fileCount: i.fileCount, submissionCount: i.submissionCount, noteCount: i.noteCount });
    expect(r).toMatchObject({ ok: true });
    expect("warning" in r).toBe(false);
    expect(db.select().from(files).all()).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  it("backup then restore with a tombstone: the restore succeeds, counts and files match, the tombstone is kept", async () => {
    const dest = join(base, "out");
    mkdirSync(dest);
    await setBackupDestination(dest);
    const f = await store("CV.pdf", "v1");
    const g = await store("Letter.txt", "dear");
    await submit([f.id, g.id]);
    await del(f.id);
    const b = await createBackup(dest, new Date(2026, 10, 9, 10, 0));
    if (!b.ok) throw new Error(b.error);
    expect(b).toMatchObject({ fileCount: 1 }); // the manifest counts the bytes that exist
    const zip = join(base, "b.zip");
    cpSync(b.path, zip);
    rmSync(b.path);

    const counts = dbRestore.currentCounts();
    expect(counts.files).toBe(1);
    rmSync(join(root, g.relativePath));
    const r = await restoreFromBackup(zip, { createdAt: b.createdAt, counts });
    expect(r).toMatchObject({ ok: true, counts: { files: 1, submissions: 1 }, warnings: [] });
    expect(existsSync(join(root, g.relativePath))).toBe(true);
    expect(existsSync(join(root, f.relativePath))).toBe(false);
    expect(row(f.id)!.deletedAt).toBeInstanceOf(Date);
    const [s] = await listSubmissions(appId);
    expect(s.files.map((x) => [x.storedName, x.deletedAt !== null])).toEqual([[f.storedName, true], [g.storedName, false]]);
  });

  it("the backup action reports the files on disk, not the tombstone", async () => {
    const dest = join(base, "out2");
    mkdirSync(dest);
    await setBackupDestination(dest);
    const f = await store("CV.pdf", "v1");
    await submit([f.id]);
    await del(f.id);
    expect(await backUpNow()).toMatchObject({ ok: true, fileCount: 0 });
  });

  it("history events of other kinds are untouched: the new kind is in the CHECK list", async () => {
    expect(() => getDb().insert(activityEvents).values({ userId: "local", applicationId: appId, kind: "file_deleted", details: "{}" }).run()).not.toThrow();
    await expect(getFileDeleteImpact(1)).resolves.toBeNull();
  });
});
