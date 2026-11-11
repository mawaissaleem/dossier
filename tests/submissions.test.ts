import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteApplication, getDeleteImpact } from "@/lib/db/applications";
import { applications, files, submissionFiles, submissions, tracks, type NewStoredFile } from "@/lib/db/schema";
import { createSubmission, listSubmissions, NOTE_MAX } from "@/lib/db/submissions";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let appId: number;
let n = 0;
const mkApp = (userId = "local", t = trackId) => db.insert(applications).values({ userId, trackId: t, title: "A" }).returning().get().id;
const mkFile = (over: Partial<NewStoredFile> = {}) => {
  n++;
  return db.insert(files).values({
    userId: "local", applicationId: appId, label: "CV", originalName: `cv${n}.docx`, storedName: `CV_${n}.docx`, relativePath: `job/a/CV_${n}.docx`,
    sha256: "a".repeat(64), sizeBytes: 10, uploadDate: "2026-11-0" + (n % 9 + 1), baseName: "CV", extension: "docx", seq: n, ...over,
  }).returning().get().id;
};
const counts = () => [db.select().from(submissions).all().length, db.select().from(submissionFiles).all().length];

beforeEach(() => {
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  appId = mkApp();
});
afterEach(dropTestDb);

describe("createSubmission", () => {
  it("creates a submission with its files, user and note trimmed", async () => {
    const [a, b] = [mkFile(), mkFile()];
    const r = await createSubmission(appId, [a, b], "2026-11-09", "  sent by post \n");
    expect(r.ok).toBe(true);
    const row = db.select().from(submissions).get()!;
    expect(row).toMatchObject({ applicationId: appId, userId: "local", date: "2026-11-09", note: "sent by post" });
    expect(db.select().from(submissionFiles).all().map((l) => [l.userId, l.submissionId, l.fileId])).toEqual([["local", row.id, a], ["local", row.id, b]]);
  });

  it("allows zero files, blank or missing note becomes null, and de-duplicates file ids", async () => {
    expect((await createSubmission(appId, [], "2026-11-09", "   ")).ok).toBe(true);
    expect((await createSubmission(appId, [], "2026-11-09", undefined)).ok).toBe(true);
    expect(db.select().from(submissions).all().map((s) => s.note)).toEqual([null, null]);
    const f = mkFile();
    expect((await createSubmission(appId, [f, f, f], "2026-11-09", null)).ok).toBe(true);
    expect(db.select().from(submissionFiles).all()).toHaveLength(1);
  });

  it("lets one file belong to two submissions without storing it twice (FR-7.5)", async () => {
    const f = mkFile();
    await createSubmission(appId, [f], "2026-11-09", null);
    await createSubmission(appId, [f], "2026-11-10", null);
    expect(db.select().from(files).all()).toHaveLength(1);
    expect(counts()).toEqual([2, 2]);
  });

  it("refuses a file of another application, another user, or a missing file, and writes nothing", async () => {
    const mine = mkFile();
    const otherApp = mkApp();
    const theirs = mkFile({ applicationId: otherApp });
    const otherTrack = db.insert(tracks).values({ userId: "other", name: "X", position: 0 }).returning().get().id;
    const foreignApp = mkApp("other", otherTrack);
    const foreignFile = mkFile({ applicationId: foreignApp, userId: "other" });
    for (const bad of [theirs, foreignFile, 9999]) {
      const r = await createSubmission(appId, [mine, bad], "2026-11-09", "x");
      expect(r.ok, String(bad)).toBe(false);
    }
    expect(await createSubmission(appId, [foreignFile], "2026-11-09", null)).toMatchObject({ ok: false });
    expect(counts()).toEqual([0, 0]);
  });

  it("refuses an unknown or another user's application", async () => {
    const otherTrack = db.insert(tracks).values({ userId: "other", name: "X", position: 0 }).returning().get().id;
    expect(await createSubmission(9999, [], "2026-11-09", null)).toEqual({ ok: false, error: "Application not found." });
    expect(await createSubmission(mkApp("other", otherTrack), [], "2026-11-09", null)).toEqual({ ok: false, error: "Application not found." });
    expect(counts()).toEqual([0, 0]);
  });

  it("refuses a bad date", async () => {
    for (const d of ["", "2026-02-30", "2026-13-01", "09/11/2026", "2026-1-1", undefined, 20261109]) {
      expect((await createSubmission(appId, [], d as string, null)).ok, String(d)).toBe(false);
    }
    expect(counts()).toEqual([0, 0]);
  });

  it("accepts a note of the maximum length and refuses one longer; length is checked after trimming", async () => {
    expect((await createSubmission(appId, [], "2026-11-09", "x".repeat(NOTE_MAX))).ok).toBe(true);
    expect((await createSubmission(appId, [], "2026-11-09", ` ${"x".repeat(NOTE_MAX)} `)).ok).toBe(true);
    expect((await createSubmission(appId, [], "2026-11-09", "x".repeat(NOTE_MAX + 1))).ok).toBe(false);
    expect(counts()).toEqual([2, 0]);
  });
});

describe("listSubmissions", () => {
  it("is empty without submissions", async () => {
    expect(await listSubmissions(appId)).toEqual([]);
  });

  it("orders newest first (date desc, then id desc) with each submission's files, and only this application's", async () => {
    const f1 = mkFile({ label: "CV" });
    const f2 = mkFile({ label: "Cover letter" });
    const s1 = (await createSubmission(appId, [f1], "2026-11-09", "first")) as { id: number };
    const s2 = (await createSubmission(appId, [f1, f2], "2026-11-09", null)) as { id: number };
    const s3 = (await createSubmission(appId, [], "2026-11-01", "older, added later")) as { id: number };
    await createSubmission(mkApp(), [], "2026-12-01", "other app");
    const list = await listSubmissions(appId);
    expect(list.map((s) => s.id)).toEqual([s2.id, s1.id, s3.id]);
    expect(list[0].files.map((f) => f.id)).toEqual([f1, f2]);
    expect(list[0].files[1]).toEqual({ id: f2, originalName: expect.any(String), storedName: expect.any(String), label: "Cover letter", uploadDate: expect.any(String), sizeBytes: expect.any(Number), sha256: expect.any(String), integrity: "ok", checkedAt: null, deletedAt: null });
    expect(list[1]).toMatchObject({ note: "first", date: "2026-11-09" });
    expect(list[2]).toMatchObject({ note: "older, added later", files: [] });
  });

  it("keeps the original file in the old submission when a corrected one goes in a new one (AT-10)", async () => {
    const old = mkFile({ originalName: "cv.docx" });
    await createSubmission(appId, [old], "2026-11-09", null);
    const fixed = mkFile({ originalName: "cv-fixed.docx" });
    await createSubmission(appId, [fixed], "2026-11-10", null);
    const [newer, older] = await listSubmissions(appId);
    expect(older.files.map((f) => f.id)).toEqual([old]);
    expect(newer.files.map((f) => f.id)).toEqual([fixed]);
  });
});

describe("deletes", () => {
  it("deleting a submission row removes its links and keeps the file", async () => {
    const f = mkFile();
    const { id } = (await createSubmission(appId, [f], "2026-11-09", null)) as { id: number };
    db.delete(submissions).where(eq(submissions.id, id)).run();
    expect(counts()).toEqual([0, 0]);
    expect(db.select().from(files).all()).toHaveLength(1);
  });

  it("a file in a submission cannot be deleted", async () => {
    const f = mkFile();
    await createSubmission(appId, [f], "2026-11-09", null);
    expect(() => db.delete(files).where(eq(files.id, f)).run()).toThrow(/FOREIGN KEY/);
    expect(db.select().from(files).all()).toHaveLength(1);
  });

  it("deleting the application removes its submissions and links, even with files in them", async () => {
    await createSubmission(appId, [mkFile()], "2026-11-09", null);
    const keep = mkApp();
    await createSubmission(keep, [], "2026-11-09", null);
    db.delete(applications).where(eq(applications.id, appId)).run();
    expect(counts()).toEqual([1, 0]);
    expect(db.select().from(files).all()).toEqual([]);
  });
});

describe("delete impact", () => {
  it("counts the application's submissions only and deleteApplication refuses when the count changed", async () => {
    expect((await getDeleteImpact(appId))?.submissionCount).toBe(0);
    await createSubmission(appId, [], "2026-11-09", null);
    await createSubmission(appId, [], "2026-11-10", null);
    await createSubmission(mkApp(), [], "2026-11-10", null); // not counted
    expect(await getDeleteImpact(appId)).toMatchObject({ submissionCount: 2 });
    const shown = { cellCount: 0, fileCount: 0, noteCount: 0 };
    expect(await deleteApplication(appId, { ...shown, submissionCount: 1 })).toMatchObject({ ok: false });
    expect(await deleteApplication(appId, { ...shown, submissionCount: 0 })).toMatchObject({ ok: false });
    expect(db.select().from(submissions).all()).toHaveLength(3);
    expect(await deleteApplication(appId, { ...shown, submissionCount: 2 })).toMatchObject({ ok: true });
    expect(db.select().from(submissions).all()).toHaveLength(1);
  });
});
