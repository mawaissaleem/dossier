import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createApplication, updateApplication } from "@/app/actions/applications";
import { updateCell } from "@/app/actions/cells";
import { confirmSubmittedStatus, fetchReviewFiles } from "@/app/actions/submissions";
import { applications, cellValues, columnOptions, columns, files, submissionFiles, submissions, tracks, type NewStoredFile } from "@/lib/db/schema";
import { createSubmission } from "@/lib/db/submissions";
import { setExpectedLabels, setSubmittedStatuses } from "@/lib/db/track-settings";
import { submissionWarnings } from "@/lib/expected-labels";
import { needsSubmissionReview } from "@/lib/submission-review";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

describe("needsSubmissionReview (pure)", () => {
  const base = { isStatus: true, optionId: 2, currentOptionId: 1, submittedIds: [2, 3], submissionCount: 0 };
  it("is true only for a changed move to a submitted option with no submission yet", () => {
    expect(needsSubmissionReview(base)).toBe(true);
    expect(needsSubmissionReview({ ...base, currentOptionId: null })).toBe(true);
  });
  it.each([
    ["not the status column", { isStatus: false }],
    ["blank status", { optionId: null }],
    ["same option as now", { currentOptionId: 2 }],
    ["not a submitted option", { optionId: 1, currentOptionId: null }],
    ["already has a submission", { submissionCount: 1 }],
    ["nothing counts as submitted", { submittedIds: [] }],
  ])("is false: %s", (_n, over) => expect(needsSubmissionReview({ ...base, ...over })).toBe(false));
});

let db: ReturnType<typeof useTestDb>;
let trackId: number, statusCol: number, textCol: number;
let toApply: number, applied: number, interview: number;
let appId: number;
let n = 0;
const opt = (columnId: number, label: string, position: number) => db.insert(columnOptions).values({ userId: "local", columnId, label, color: "blue", position }).returning().get().id;
const mkApp = () => db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
const mkFile = (applicationId = appId, over: Partial<NewStoredFile> = {}) => {
  n++;
  return db.insert(files).values({
    userId: "local", applicationId, label: "CV", originalName: `cv${n}.docx`, storedName: `CV_${n}.docx`, relativePath: `job/a/CV_${n}.docx`,
    sha256: "a".repeat(64), sizeBytes: 10, uploadDate: "2026-11-05", baseName: "CV", extension: "docx", seq: n, ...over,
  }).returning().get().id;
};
const setStatus = (optionId: number, aid = appId) => db.insert(cellValues).values({ userId: "local", applicationId: aid, columnId: statusCol, valueOptionId: optionId }).run();
const statusOf = (aid = appId) => db.select().from(cellValues).where(and(eq(cellValues.applicationId, aid), eq(cellValues.columnId, statusCol))).get()?.valueOptionId ?? null;
const counts = () => [db.select().from(submissions).all().length, db.select().from(submissionFiles).all().length];

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  statusCol = db.insert(columns).values({ userId: "local", trackId, name: "Status", type: "single_select", position: 0, isStatus: true }).returning().get().id;
  textCol = db.insert(columns).values({ userId: "local", trackId, name: "Notes", type: "text", position: 1 }).returning().get().id;
  [toApply, applied, interview] = [opt(statusCol, "To apply", 0), opt(statusCol, "Applied", 1), opt(statusCol, "Interview", 2)]; // "Applied" counts as submitted by default (6.1)
  appId = mkApp();
  setStatus(toApply);
});
afterEach(dropTestDb);

describe("updateCell on the status column", () => {
  it("returns needsReview and saves nothing for a submitted status without submissions", async () => {
    const r = await updateCell(appId, statusCol, applied);
    expect(r).toMatchObject({ ok: false, needsReview: true });
    expect(statusOf()).toBe(toApply);
    expect(counts()).toEqual([0, 0]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves directly for a status that is not submitted", async () => {
    expect(await updateCell(appId, statusCol, interview)).toEqual({ ok: true, value: interview });
    expect(statusOf()).toBe(interview);
  });

  it("saves directly when the application already has a submission, and moving back keeps it (FR-7.8)", async () => {
    await createSubmission(appId, [], "2026-11-09", null);
    expect((await updateCell(appId, statusCol, applied)).ok).toBe(true);
    expect((await updateCell(appId, statusCol, toApply)).ok).toBe(true);
    expect(counts()[0]).toBe(1);
  });

  it("saves directly when the value is already that status, and for a blank", async () => {
    db.update(cellValues).set({ valueOptionId: applied }).run(); // e.g. set before the rule existed
    expect((await updateCell(appId, statusCol, applied)).ok).toBe(true);
    expect((await updateCell(appId, statusCol, null)).ok).toBe(true);
  });

  it("respects the track's saved submitted list, not the label", async () => {
    await setSubmittedStatuses(trackId, [interview]);
    expect((await updateCell(appId, statusCol, applied)).ok).toBe(true);
    expect(await updateCell(appId, statusCol, interview)).toMatchObject({ ok: false, needsReview: true });
  });

  it("does not apply to a non-status single-select column", async () => {
    const other = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 2 }).returning().get().id;
    const o = opt(other, "Applied", 0);
    expect((await updateCell(appId, other, o)).ok).toBe(true);
  });
});

describe("updateApplication (detail form)", () => {
  it("returns needsReview and saves nothing, title and other cells included", async () => {
    const r = await updateApplication(appId, "New title", [{ columnId: statusCol, value: applied }, { columnId: textCol, value: "x" }]);
    expect(r).toMatchObject({ ok: false, needsReview: true });
    expect(db.select().from(applications).get()!.title).toBe("A");
    expect(statusOf()).toBe(toApply);
    expect(db.select().from(cellValues).all()).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves directly for a non-submitted status, an existing submission, or no status change", async () => {
    expect((await updateApplication(appId, "T", [{ columnId: statusCol, value: interview }])).ok).toBe(true);
    expect((await updateApplication(appId, "T2", [{ columnId: textCol, value: "x" }])).ok).toBe(true);
    await createSubmission(appId, [], "2026-11-09", null);
    expect((await updateApplication(appId, "T3", [{ columnId: statusCol, value: applied }])).ok).toBe(true);
    expect(statusOf()).toBe(applied);
  });
});

describe("createApplication", () => {
  it("allows a new application to start in a submitted status, with no submission", async () => {
    const r = await createApplication("B", trackId, [{ columnId: statusCol, value: applied }]);
    expect(r.ok).toBe(true);
    expect(counts()).toEqual([0, 0]);
  });
});

describe("confirmSubmittedStatus", () => {
  it("saves the status and the first submission together, and refreshes", async () => {
    const [a, b] = [mkFile(), mkFile()];
    expect(await confirmSubmittedStatus(appId, statusCol, applied, [a, b], "2026-11-09", " sent ")).toEqual({ ok: true });
    expect(statusOf()).toBe(applied);
    expect(db.select().from(submissions).get()).toMatchObject({ applicationId: appId, date: "2026-11-09", note: "sent" });
    expect(counts()).toEqual([1, 2]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("allows an empty file list and a null note", async () => {
    expect(await confirmSubmittedStatus(appId, statusCol, applied, [], "2026-11-09", null)).toEqual({ ok: true });
    expect(counts()).toEqual([1, 0]);
  });

  it("either both or neither: an invalid submission leaves the status alone", async () => {
    const foreign = mkFile(mkApp());
    for (const [ids, date] of [[[foreign], "2026-11-09"], [[], "2026-02-30"], [[], "09/11/2026"]] as const) {
      const r = await confirmSubmittedStatus(appId, statusCol, applied, [...ids], date, null);
      expect(r.ok).toBe(false);
    }
    expect((await confirmSubmittedStatus(appId, statusCol, applied, [], "2026-11-09", "x".repeat(2001))).ok).toBe(false);
    expect(statusOf()).toBe(toApply);
    expect(counts()).toEqual([0, 0]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a status that is not submitted, a non-status column, a foreign option and an unknown application", async () => {
    const other = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 2 }).returning().get().id;
    const otherOpt = opt(other, "Applied", 0);
    expect(await confirmSubmittedStatus(appId, statusCol, interview, [], "2026-11-09", null)).toEqual({ ok: false, error: "That status no longer counts as submitted. Reload the page and try again." });
    expect((await confirmSubmittedStatus(appId, other, otherOpt, [], "2026-11-09", null)).ok).toBe(false);
    expect(await confirmSubmittedStatus(appId, statusCol, otherOpt, [], "2026-11-09", null)).toEqual({ ok: false, error: "That status no longer exists. Reload the page and try again." });
    expect((await confirmSubmittedStatus(9999, statusCol, applied, [], "2026-11-09", null)).ok).toBe(false);
    expect(statusOf()).toBe(toApply);
    expect(counts()).toEqual([0, 0]);
  });

  it("refuses when a submission already exists (stale dialog), writing nothing", async () => {
    await createSubmission(appId, [], "2026-11-08", null);
    const r = await confirmSubmittedStatus(appId, statusCol, applied, [], "2026-11-09", null);
    expect(r.ok).toBe(false);
    expect(statusOf()).toBe(toApply);
    expect(counts()[0]).toBe(1);
  });

  // One argument broken per case, everything else valid (status column, submitted option, real file), so only the input check can refuse it.
  it.each([
    ["string application id", 0, "1"],
    ["zero application id", 0, 0],
    ["string column id", 1, "1"],
    ["zero column id", 1, 0],
    ["float option id", 2, 1.5],
    ["string option id", 2, "2"],
    ["files not an array", 3, "1"],
    ["float file id", 3, [1.5]],
    ["negative file id", 3, [-1]],
    ["object file id", 3, [{}]],
    ["too many files", 3, Array.from({ length: 1001 }, (_, i) => i + 1)],
    ["non-string date", 4, 20261109],
    ["non-string note", 5, 5],
  ])("rejects a malformed payload: %s", async (_n, at, bad) => {
    const args: unknown[] = [appId, statusCol, applied, [mkFile()], "2026-11-09", null];
    args[at] = bad;
    const r = await (confirmSubmittedStatus as (...a: unknown[]) => ReturnType<typeof confirmSubmittedStatus>)(...args);
    expect(r.ok).toBe(false);
    expect(statusOf()).toBe(toApply);
    expect(counts()).toEqual([0, 0]);
  });
});

describe("AT-9: submitted status with no CV", () => {
  it("warns about the missing CV, then saves the status and a submission with the attached file after confirming", async () => {
    await setExpectedLabels(trackId, ["CV", "Cover letter"]);
    const cover = mkFile(appId, { label: "Cover letter", originalName: "cl.pdf" });
    // 1. status -> Applied: nothing saved, the review opens
    expect(await updateCell(appId, statusCol, applied)).toMatchObject({ ok: false, needsReview: true });
    // 2. the dialog's data: files + expected labels, run through the same pure function the dialog uses
    const r = await fetchReviewFiles(appId);
    if (!r.ok) throw new Error(r.error);
    expect(r.expectedLabels).toEqual(["CV", "Cover letter"]);
    expect(submissionWarnings(r.files.map((f) => f.label), r.expectedLabels)).toEqual(["No file labelled CV"]);
    // 3. confirmed anyway
    expect(await confirmSubmittedStatus(appId, statusCol, applied, r.files.map((f) => f.id), "2026-11-09", null)).toEqual({ ok: true });
    expect(statusOf()).toBe(applied);
    expect(db.select().from(submissionFiles).all().map((l) => l.fileId)).toEqual([cover]);
    expect(counts()).toEqual([1, 1]);
  });

  it("fetchReviewFiles gives no expected labels when the track has none saved", async () => {
    const r = await fetchReviewFiles(appId);
    expect(r).toMatchObject({ ok: true, expectedLabels: [] });
  });
});

describe("fetchReviewFiles", () => {
  it("lists the application's files only, with name, label and date", async () => {
    const a = mkFile(appId, { label: "Cover letter", originalName: "cl.pdf" });
    mkFile(mkApp());
    const r = await fetchReviewFiles(appId);
    expect(r).toEqual({ ok: true, files: [{ id: a, originalName: "cl.pdf", label: "Cover letter", uploadDate: "2026-11-05" }], expectedLabels: [] });
  });
  it("refuses a bad or unknown id", async () => {
    expect((await fetchReviewFiles(0)).ok).toBe(false);
    expect((await fetchReviewFiles(9999)).ok).toBe(false);
  });
});
