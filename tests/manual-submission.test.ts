import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { updateCell } from "@/app/actions/cells";
import { addSubmission } from "@/app/actions/submissions";
import { applications, cellValues, columnOptions, columns, files, submissionFiles, submissions, tracks, type NewStoredFile } from "@/lib/db/schema";
import { createManualSubmission, createSubmission, listSubmissions } from "@/lib/db/submissions";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number, statusCol: number, otherCol: number;
let toApply: number, applied: number, interview: number, foreignOpt: number;
let appId: number;
let n = 0;
const opt = (columnId: number, label: string, position: number) => db.insert(columnOptions).values({ userId: "local", columnId, label, color: "blue", position }).returning().get().id;
const mkFile = (over: Partial<NewStoredFile> = {}) => {
  n++;
  return db.insert(files).values({
    userId: "local", applicationId: appId, label: "CV", originalName: `cv${n}.docx`, storedName: `CV_${String(n).padStart(2, "0")}.docx`, relativePath: `job/a/CV_${n}.docx`,
    sha256: String(n).padStart(64, "0"), sizeBytes: 10, uploadDate: "2026-11-05", baseName: "CV", extension: "docx", seq: n, ...over,
  }).returning().get().id;
};
const statusOf = () => db.select().from(cellValues).where(and(eq(cellValues.applicationId, appId), eq(cellValues.columnId, statusCol))).get()?.valueOptionId ?? null;
const counts = () => [db.select().from(submissions).all().length, db.select().from(submissionFiles).all().length];

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  statusCol = db.insert(columns).values({ userId: "local", trackId, name: "Status", type: "single_select", position: 0, isStatus: true }).returning().get().id;
  otherCol = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 1 }).returning().get().id;
  [toApply, applied, interview] = [opt(statusCol, "To apply", 0), opt(statusCol, "Applied", 1), opt(statusCol, "Interview", 2)];
  foreignOpt = opt(otherCol, "X", 0);
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
  db.insert(cellValues).values({ userId: "local", applicationId: appId, columnId: statusCol, valueOptionId: toApply }).run();
});
afterEach(dropTestDb);

describe("addSubmission", () => {
  it("creates the application's first submission without a status change, and later status moves do not ask for a review", async () => {
    const f = mkFile();
    expect(await addSubmission(appId, [f], "2026-11-09", " Extra transcript ", null)).toEqual({ ok: true });
    expect(db.select().from(submissions).get()).toMatchObject({ applicationId: appId, date: "2026-11-09", note: "Extra transcript" });
    expect(statusOf()).toBe(toApply);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await updateCell(appId, statusCol, applied)).ok).toBe(true); // a submission exists, so the 6.4 review is not triggered
  });

  it("adds a further submission when others exist, keeping the earlier ones", async () => {
    const [cv, tr] = [mkFile(), mkFile({ label: "Transcript" })];
    await createSubmission(appId, [cv], "2026-11-01", "first");
    expect(await addSubmission(appId, [tr], "2026-11-20", "Extra transcript", null)).toEqual({ ok: true });
    const [newer, older] = await listSubmissions(appId);
    expect(newer).toMatchObject({ note: "Extra transcript", files: [{ id: tr }] });
    expect(older).toMatchObject({ note: "first", files: [{ id: cv }] });
  });

  it("saves the status change with the submission, even to a submitted status on an application with none", async () => {
    expect(await addSubmission(appId, [mkFile()], "2026-11-09", null, { columnId: statusCol, optionId: applied })).toEqual({ ok: true });
    expect(statusOf()).toBe(applied);
    expect(counts()).toEqual([1, 1]);
  });

  it("refuses zero files, a bad date and a long note, saving nothing and not refreshing", async () => {
    const f = mkFile();
    for (const [ids, date, note] of [[[], "2026-11-09", null], [[f], "2026-02-30", null], [[f], "2026-11-09", "x".repeat(2001)]] as const) {
      expect((await addSubmission(appId, [...ids], date, note, { columnId: statusCol, optionId: applied })).ok).toBe(false);
    }
    expect(counts()).toEqual([0, 0]);
    expect(statusOf()).toBe(toApply);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is all or nothing: a bad status or a foreign file leaves the submission and the status unwritten", async () => {
    const mine = mkFile();
    const otherApp = db.insert(applications).values({ userId: "local", trackId, title: "B" }).returning().get().id;
    const theirs = mkFile({ applicationId: otherApp });
    const cases: [number[], { columnId: number; optionId: number }][] = [
      [[mine], { columnId: otherCol, optionId: foreignOpt }], // not the status column
      [[mine], { columnId: statusCol, optionId: foreignOpt }], // option of another column
      [[mine], { columnId: statusCol, optionId: 9999 }],
      [[mine, theirs], { columnId: statusCol, optionId: interview }], // file of another application
    ];
    for (const [ids, status] of cases) expect((await addSubmission(appId, ids, "2026-11-09", null, status)).ok, JSON.stringify(status)).toBe(false);
    expect(counts()).toEqual([0, 0]);
    expect(statusOf()).toBe(toApply);
  });

  it("refuses bad argument shapes from a direct POST", async () => {
    const f = mkFile();
    const bad = [
      () => addSubmission(0, [f], "2026-11-09", null, null),
      () => addSubmission(appId, "x" as never, "2026-11-09", null, null),
      () => addSubmission(appId, [1.5], "2026-11-09", null, null),
      () => addSubmission(appId, [f], 5 as never, null, null),
      () => addSubmission(appId, [f], "2026-11-09", 5 as never, null),
      () => addSubmission(appId, [f], "2026-11-09", null, { columnId: "a", optionId: 1 } as never),
      () => addSubmission(appId, [f], "2026-11-09", null, 5 as never),
      () => addSubmission(9999, [f], "2026-11-09", null, null),
    ];
    for (const call of bad) expect((await call()).ok).toBe(false);
    expect(counts()).toEqual([0, 0]);
  });
});

describe("createManualSubmission", () => {
  it("writes a status for an application that had no status cell yet", async () => {
    db.delete(cellValues).run();
    expect((await createManualSubmission(appId, [mkFile()], "2026-11-09", null, { columnId: statusCol, optionId: interview })).ok).toBe(true);
    expect(statusOf()).toBe(interview);
  });
});
