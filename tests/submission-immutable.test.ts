import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { updateApplication } from "@/app/actions/applications";
import { updateCell } from "@/app/actions/cells";
import * as submissionActions from "@/app/actions/submissions";
import { editSubmissionNote } from "@/app/actions/submissions";
import { applications, cellValues, columnOptions, columns, files, submissionFiles, submissions, tracks, type NewStoredFile } from "@/lib/db/schema";
import * as submissionData from "@/lib/db/submissions";
import { createSubmission, listSubmissions, NOTE_MAX, updateSubmissionNote } from "@/lib/db/submissions";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number, statusCol: number, appId: number, toApply: number, applied: number, interview: number;
let n = 0;
const opt = (label: string, position: number) => db.insert(columnOptions).values({ userId: "local", columnId: statusCol, label, color: "blue", position }).returning().get().id;
const mkFile = (over: Partial<NewStoredFile> = {}) => {
  n++;
  return db.insert(files).values({
    userId: "local", applicationId: appId, label: "CV", originalName: `cv${n}.pdf`, storedName: `0${n}-20261105-CV.pdf`, relativePath: `job/a/0${n}-20261105-CV.pdf`,
    sha256: String(n).padStart(64, "0"), sizeBytes: 10, uploadDate: "2026-11-05", baseName: "CV", extension: "pdf", seq: n, ...over,
  }).returning().get().id;
};
const statusOf = () => db.select().from(cellValues).where(and(eq(cellValues.applicationId, appId), eq(cellValues.columnId, statusCol))).get()?.valueOptionId ?? null;
const setStatus = (optionId: number) => db.update(cellValues).set({ valueOptionId: optionId }).where(and(eq(cellValues.applicationId, appId), eq(cellValues.columnId, statusCol))).run();
const idOf = async (r: Promise<{ ok: boolean; id?: number }>) => { const x = await r; if (!x.ok) throw new Error("setup failed"); return x.id!; };

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  statusCol = db.insert(columns).values({ userId: "local", trackId, name: "Status", type: "single_select", position: 0, isStatus: true }).returning().get().id;
  [toApply, applied, interview] = [opt("To apply", 0), opt("Applied", 1), opt("Interview", 2)]; // "Applied" counts as submitted by default (6.1)
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
  db.insert(cellValues).values({ userId: "local", applicationId: appId, columnId: statusCol, valueOptionId: toApply }).run();
});
afterEach(dropTestDb);

describe("updateSubmissionNote (FR-7.6)", () => {
  it("changes the note, trimmed, and nothing else", async () => {
    const [a, b] = [mkFile(), mkFile()];
    const id = await idOf(createSubmission(appId, [a, b], "2026-11-08", "old"));
    const before = db.select().from(submissions).where(eq(submissions.id, id)).get()!;
    const links = db.select().from(submissionFiles).all();
    expect(await updateSubmissionNote(id, "  new note  ")).toEqual({ ok: true });
    const after = db.select().from(submissions).where(eq(submissions.id, id)).get()!;
    expect(after.note).toBe("new note");
    expect({ ...after, note: null, updatedAt: null }).toEqual({ ...before, note: null, updatedAt: null }); // date, application, user and created_at unchanged
    expect(db.select().from(submissionFiles).all()).toEqual(links);
    expect((await listSubmissions(appId))[0]).toMatchObject({ date: "2026-11-08", note: "new note", files: [{ id: a }, { id: b }] });
  });

  it("accepts the maximum length and refuses a longer note, keeping the old one", async () => {
    const id = await idOf(createSubmission(appId, [], "2026-11-08", "keep"));
    expect(await updateSubmissionNote(id, "x".repeat(NOTE_MAX))).toEqual({ ok: true });
    expect((await updateSubmissionNote(id, "y".repeat(NOTE_MAX + 1))).ok).toBe(false);
    expect(db.select().from(submissions).get()!.note).toBe("x".repeat(NOTE_MAX));
    expect(await updateSubmissionNote(id, ` ${"z".repeat(NOTE_MAX)} `)).toEqual({ ok: true }); // length is checked after trimming
  });

  it("turns a blank, whitespace or null note into null (the note can be cleared)", async () => {
    const id = await idOf(createSubmission(appId, [], "2026-11-08", "something"));
    for (const blank of ["", "   \n ", null, undefined]) {
      db.update(submissions).set({ note: "something" }).run();
      expect(await updateSubmissionNote(id, blank)).toEqual({ ok: true });
      expect(db.select().from(submissions).get()!.note).toBeNull();
    }
  });

  it("refuses an unknown id and another user's submission, changing nothing", async () => {
    const mine = await idOf(createSubmission(appId, [], "2026-11-08", "mine"));
    const otherApp = db.insert(applications).values({ userId: "someone-else", trackId, title: "B" }).returning().get().id;
    const theirs = db.insert(submissions).values({ userId: "someone-else", applicationId: otherApp, date: "2026-11-08", note: "theirs" }).returning().get().id;
    expect(await updateSubmissionNote(9999, "x")).toEqual({ ok: false, error: "Submission not found." });
    expect(await updateSubmissionNote(theirs, "x")).toEqual({ ok: false, error: "Submission not found." });
    expect(db.select().from(submissions).all().map((s) => [s.id, s.note])).toEqual([[mine, "mine"], [theirs, "theirs"]]);
  });
});

describe("editSubmissionNote action", () => {
  it("saves, refreshes once, and refuses bad arguments and unknown ids without refreshing", async () => {
    const id = await idOf(createSubmission(appId, [], "2026-11-08", null));
    expect(await editSubmissionNote(id, "hello")).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(db.select().from(submissions).get()!.note).toBe("hello");
    vi.mocked(refresh).mockClear();
    for (const call of [() => editSubmissionNote(0, "x"), () => editSubmissionNote(1.5, "x"), () => editSubmissionNote("1" as never, "x"), () => editSubmissionNote(id, 5 as never), () => editSubmissionNote(id, "x".repeat(NOTE_MAX + 1)), () => editSubmissionNote(9999, "x")]) {
      expect((await call()).ok).toBe(false);
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(db.select().from(submissions).get()!.note).toBe("hello");
  });

  it("is the only way to change or remove an existing submission: no function edits its date or files or deletes it", () => {
    const mutating = (m: object) => Object.keys(m).filter((k) => /^(update|edit|delete|remove|set|change|move)/i.test(k)).sort();
    expect(mutating(submissionData)).toEqual(["updateSubmissionNote"]);
    expect(mutating(submissionActions)).toEqual(["editSubmissionNote"]);
  });
});

describe("one file in two submissions (FR-7.5)", () => {
  it("is listed in both, and stays listed in the older one", async () => {
    const [cv, tr] = [mkFile(), mkFile({ label: "Transcript" })];
    await createSubmission(appId, [cv, tr], "2026-11-01", "first");
    await createSubmission(appId, [cv], "2026-11-15", "again");
    const [newer, older] = await listSubmissions(appId);
    expect(older.files.map((f) => f.id)).toEqual([cv, tr]);
    expect(newer.files.map((f) => f.id)).toEqual([cv]);
    expect(db.select().from(files).all()).toHaveLength(2);
  });
});

describe("moving the status backward (FR-7.8)", () => {
  it("keeps every submission and its files, and moving forward again does not open the review", async () => {
    const f = mkFile();
    await createSubmission(appId, [f], "2026-11-08", "sent");
    setStatus(applied);
    const snapshot = () => [db.select().from(submissions).all(), db.select().from(submissionFiles).all()];
    const before = snapshot();
    expect((await updateCell(appId, statusCol, toApply)).ok).toBe(true); // table: Applied -> To apply
    expect(statusOf()).toBe(toApply);
    expect(snapshot()).toEqual(before);
    expect(await updateCell(appId, statusCol, applied)).toMatchObject({ ok: true }); // forward to a submitted status: no needsReview
    expect(statusOf()).toBe(applied);
    expect(snapshot()).toEqual(before);
    expect((await updateApplication(appId, "A", [{ columnId: statusCol, value: interview }])).ok).toBe(true); // detail form, backward then forward
    expect((await updateApplication(appId, "A", [{ columnId: statusCol, value: toApply }])).ok).toBe(true);
    expect((await updateApplication(appId, "A", [{ columnId: statusCol, value: applied }])).ok).toBe(true);
    expect(snapshot()).toEqual(before);
  });

  it("without any submission the same forward move still asks for the review (control)", async () => {
    expect(await updateCell(appId, statusCol, applied)).toMatchObject({ ok: false, needsReview: true });
  });
});
