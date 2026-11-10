import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listActivity } from "@/lib/db/activity";
import { createApplication, updateApplication } from "@/lib/db/applications";
import { setCellValue } from "@/lib/db/cells";
import { deleteOption } from "@/lib/db/options";
import { activityEvents, applications, cellValues, columnOptions, columns, files, submissions, tracks } from "@/lib/db/schema";
import { insertFileRow } from "@/lib/db/files";
import { createManualSubmission, createSubmission, submitWithStatus } from "@/lib/db/submissions";
import { getFilesRoot, setFilesRoot } from "@/lib/db/settings";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number, statusCol: number, other: number, appId: number;
let opts: Record<string, number>;
let n = 0;
const events = (id = appId) => db.select().from(activityEvents).where(eq(activityEvents.applicationId, id)).orderBy(activityEvents.id).all();
const kinds = (id = appId) => events(id).map((e) => e.kind);
const mkApp = async (values: { columnId: number; value: unknown }[] = []) => {
  const r = await createApplication({ title: "T", trackId, values });
  if (!r.ok) throw new Error(r.error);
  return r.id;
};
const fileRow = (over = {}) => {
  n++;
  return { applicationId: appId, label: "CV", originalName: `cv${n}.docx`, storedName: `CV_${n}.docx`, relativePath: `job/a/CV_${n}.docx`, sha256: String(n).padStart(64, "0"),
    sizeBytes: 1, uploadDate: "2026-11-05", baseName: "CV", extension: "docx", seq: n, ...over };
};
const mkFile = () => insertFileRow(fileRow());

beforeEach(async () => {
  db = useTestDb();
  n = 0;
  runSeed();
  trackId = db.select().from(tracks).where(eq(tracks.name, "Job")).get()!.id;
  statusCol = db.select().from(columns).where(and(eq(columns.trackId, trackId), eq(columns.isStatus, true))).get()!.id;
  opts = Object.fromEntries(db.select().from(columnOptions).where(eq(columnOptions.columnId, statusCol)).all().map((o) => [o.label, o.id]));
  other = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 99 }).returning().get().id;
  appId = await mkApp([{ columnId: statusCol, value: null }]); // explicit blank: no default status
});
afterEach(dropTestDb);

describe("status_changed", () => {
  const [a, b, appliedLabel] = ["To apply", "Interview", "Applied"];

  it("setCellValue writes one event with ids and labels, and none when unchanged", async () => {
    expect(events()).toHaveLength(0); // blank on create: no event
    await setCellValue(appId, statusCol, opts[a]);
    await setCellValue(appId, statusCol, opts[a]);
    await setCellValue(appId, statusCol, opts[b]);
    await setCellValue(appId, statusCol, null);
    const d = (await listActivity(appId)).reverse().map((e) => e.details);
    expect(d).toEqual([
      { kind: "status_changed", columnId: statusCol, fromOptionId: null, fromLabel: null, toOptionId: opts[a], toLabel: a },
      { kind: "status_changed", columnId: statusCol, fromOptionId: opts[a], fromLabel: a, toOptionId: opts[b], toLabel: b },
      { kind: "status_changed", columnId: statusCol, fromOptionId: opts[b], fromLabel: b, toOptionId: null, toLabel: null },
    ]);
  });

  it("a non-status column logs nothing", async () => {
    const o = db.insert(columnOptions).values({ userId: "local", columnId: other, label: "X", color: "blue", position: 0 }).returning().get().id;
    await setCellValue(appId, other, o);
    expect(events()).toHaveLength(0);
  });

  it("updateApplication logs a changed status once and an unchanged one never", async () => {
    await updateApplication({ id: appId, title: "T2", values: [{ columnId: statusCol, value: opts[a] }] });
    await updateApplication({ id: appId, title: "T3", values: [{ columnId: statusCol, value: opts[a] }] });
    expect(kinds()).toEqual(["status_changed"]);
  });

  it("createApplication logs one event from blank for an initial status (submitted or default) and none for a blank one", async () => {
    const id = await mkApp([{ columnId: statusCol, value: opts[b] }]);
    expect((await listActivity(id)).map((e) => e.details)).toEqual([{ kind: "status_changed", columnId: statusCol, fromOptionId: null, fromLabel: null, toOptionId: opts[b], toLabel: b }]);
    const withDefault = await mkApp(); // the seeded Status default "To apply" applies
    expect((await listActivity(withDefault)).map((e) => e.details)).toMatchObject([{ toLabel: a, fromOptionId: null }]);
    expect(events(appId)).toHaveLength(0);
  });

  it("submitWithStatus and createManualSubmission with a status log the status and the submission, once each", async () => {
    const applied = opts[appliedLabel]; // a submitted status in the seed
    const f = await mkFile();
    const r = await submitWithStatus(appId, statusCol, applied, [f], "2026-11-10", null);
    expect(r.ok).toBe(true);
    expect(kinds().sort()).toEqual(["file_uploaded", "status_changed", "submission_created"]);
    await createManualSubmission(appId, [f], "2026-11-10", null, { columnId: statusCol, optionId: opts[a] });
    expect(kinds().filter((k) => k === "status_changed")).toHaveLength(2);
    await createManualSubmission(appId, [f], "2026-11-10", null, { columnId: statusCol, optionId: opts[a] }); // same status: only the submission
    expect(kinds().filter((k) => k === "status_changed")).toHaveLength(2);
    expect(kinds().filter((k) => k === "submission_created")).toHaveLength(3);
  });

  it("deleteOption writes one event per affected application (reassign and clear), archived ones included", async () => {
    const x = await mkApp([{ columnId: statusCol, value: opts[a] }]);
    const y = await mkApp([{ columnId: statusCol, value: opts[a] }]);
    db.update(applications).set({ archived: true }).where(eq(applications.id, y)).run();
    const z = await mkApp([{ columnId: statusCol, value: opts[b] }]);
    const before = [x, y, z].map((i) => events(i).length);
    expect(await deleteOption(opts[a], opts[b], 2)).toEqual({ ok: true });
    expect([x, y, z].map((i) => events(i).length)).toEqual([before[0] + 1, before[1] + 1, before[2]]);
    expect((await listActivity(x))[0].details).toEqual({ kind: "status_changed", columnId: statusCol, fromOptionId: opts[a], fromLabel: a, toOptionId: opts[b], toLabel: b });
    // the option is gone but the snapshot still reads
    expect(db.select().from(columnOptions).where(eq(columnOptions.id, opts[a])).get()).toBeUndefined();

    expect(await deleteOption(opts[b], null, 3)).toEqual({ ok: true }); // x, y (moved here) and z
    expect((await listActivity(z))[0].details).toEqual({ kind: "status_changed", columnId: statusCol, fromOptionId: opts[b], fromLabel: b, toOptionId: null, toLabel: null });
    expect([x, y, z].map((i) => events(i).length)).toEqual([before[0] + 2, before[1] + 2, before[2] + 1]);
  });

  it("deleting an option of a non-status column writes no events", async () => {
    const o = db.insert(columnOptions).values({ userId: "local", columnId: other, label: "X", color: "blue", position: 0 }).returning().get().id;
    await setCellValue(appId, other, o);
    expect(await deleteOption(o, null, 1)).toEqual({ ok: true });
    expect(events()).toHaveLength(0);
  });

  it("a renamed option keeps the old label in the event", async () => {
    await setCellValue(appId, statusCol, opts[a]);
    db.update(columnOptions).set({ label: "Renamed" }).where(eq(columnOptions.id, opts[a])).run();
    expect((await listActivity(appId))[0].details).toMatchObject({ toLabel: a });
  });
});

describe("file_uploaded", () => {
  it("is written with the file row, linked, with the user-editable upload date only in the details", async () => {
    const id = await insertFileRow(fileRow({ originalName: "My CV.docx", storedName: "01-20250101-My_CV.docx", uploadDate: "2025-01-01" }));
    const [e] = await listActivity(appId);
    expect(e).toMatchObject({ kind: "file_uploaded", fileId: id, submissionId: null,
      details: { kind: "file_uploaded", fileId: id, originalName: "My CV.docx", storedName: "01-20250101-My_CV.docx", label: "CV", uploadDate: "2025-01-01" } });
    expect(Math.abs(e.occurredAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("a failed insert writes no event, and an event failure leaves no file row", async () => {
    await expect(insertFileRow(fileRow({ applicationId: 99999 }))).rejects.toThrow();
    expect(db.select().from(activityEvents).all()).toHaveLength(0);
    db.run(sql`CREATE TRIGGER no_events BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(mkFile()).rejects.toThrow();
    expect(db.select().from(files).all()).toHaveLength(0);
  });

  it("a real upload logs one event; a refused duplicate logs none", async () => {
    const root = mkdtempSync(join(tmpdir(), "dossier-activity-"));
    try {
      await setFilesRoot(root);
      expect(await getFilesRoot()).toBe(root);
      const up = () => storeUploadedFile({ applicationId: appId, label: "CV", uploadDate: "2026-11-08", file: new File(["same bytes"], "cv.docx") });
      const first = await up();
      expect(first).toMatchObject({ ok: true, file: { id: expect.any(Number) } });
      expect(await up()).toMatchObject({ ok: true, duplicateOf: expect.anything() });
      const list = await listActivity(appId);
      expect(list).toHaveLength(1);
      expect(list[0].details).toMatchObject({ kind: "file_uploaded", originalName: "cv.docx", label: "CV", uploadDate: "2026-11-08" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deleting the file keeps the event, link cleared", async () => {
    const id = await mkFile();
    db.delete(files).where(eq(files.id, id)).run();
    const [e] = await listActivity(appId);
    expect(e.fileId).toBeNull();
    expect(e.details).toMatchObject({ kind: "file_uploaded", fileId: id, storedName: "CV_1.docx" });
  });
});

describe("submission_created", () => {
  it("every insert path writes exactly one event with id, date, count and stored names", async () => {
    const [f1, f2] = [await mkFile(), await mkFile()];
    const s = await createSubmission(appId, [f2, f1], "2026-11-10", null);
    if (!s.ok) throw new Error(s.error);
    const ev = (await listActivity(appId)).filter((e) => e.kind === "submission_created");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ submissionId: s.id, details: { kind: "submission_created", submissionId: s.id, date: "2026-11-10", fileCount: 2, fileNames: ["CV_2.docx", "CV_1.docx"] } });
    await createSubmission(appId, [], "2026-11-10", null); // zero files allowed
    const m = await createManualSubmission(appId, [f1], "2026-11-10", "n", null);
    expect(m.ok).toBe(true);
    expect(kinds().filter((k) => k === "submission_created")).toHaveLength(3);
  });

  it("refusals write nothing; an event failure rolls the submission back", async () => {
    const f = await mkFile();
    const before = events().length;
    expect((await createSubmission(appId, [f], "nope", null)).ok).toBe(false);
    expect((await createSubmission(appId, [123456], "2026-11-10", null)).ok).toBe(false);
    expect((await createManualSubmission(appId, [], "2026-11-10", null, null)).ok).toBe(false);
    expect(events()).toHaveLength(before);
    db.run(sql`CREATE TRIGGER no_events BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(createSubmission(appId, [f], "2026-11-10", null)).rejects.toThrow();
    expect(db.select().from(submissions).all()).toHaveLength(0);
  });

  it("an event failure rolls the status cell change back", async () => {
    db.run(sql`CREATE TRIGGER no_events BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(setCellValue(appId, statusCol, opts["To apply"])).rejects.toThrow();
    expect(db.select().from(cellValues).where(and(eq(cellValues.applicationId, appId), eq(cellValues.columnId, statusCol))).get()).toBeUndefined();
  });

  it("a backdated submission sorts by its date, below events written later", async () => {
    const f = await mkFile();
    const old = await createSubmission(appId, [f], "2026-01-02", null);
    if (!old.ok) throw new Error(old.error);
    await mkFile();
    const list = await listActivity(appId);
    expect(list.map((e) => e.kind)).toEqual(["file_uploaded", "file_uploaded", "submission_created"]);
    expect(list[2].occurredAt).toEqual(new Date(2026, 0, 2, 23, 59, 59, 999));
  });
});

describe("listActivity", () => {
  it("orders newest first by occurred_at then id, and only returns the user's events", async () => {
    const mk = (kind: "status_changed", occurredAt: number, userId = "local") =>
      db.insert(activityEvents).values({ userId, applicationId: appId, kind, occurredAt: new Date(occurredAt), details: "{}" }).returning().get().id;
    const [i1, i2, i3] = [mk("status_changed", 2000), mk("status_changed", 1000), mk("status_changed", 2000)];
    mk("status_changed", 9000, "someone-else");
    const list = await listActivity(appId);
    expect(list.map((e) => e.id)).toEqual([i3, i1, i2]);
    expect(list[0].details).toEqual({ kind: "unknown" }); // "{}" is not a valid status_changed shape
  });

  it("deleting a submission keeps its event readable with the link cleared", async () => {
    const s = await createSubmission(appId, [], "2026-11-10", null);
    if (!s.ok) throw new Error(s.error);
    db.delete(submissions).where(eq(submissions.id, s.id)).run();
    const [e] = await listActivity(appId);
    expect(e.submissionId).toBeNull();
    expect(e.details).toMatchObject({ kind: "submission_created", submissionId: s.id, date: "2026-11-10" });
  });
});
