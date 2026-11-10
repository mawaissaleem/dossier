import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { deleteApplication, getDeleteImpact } from "@/lib/db/applications";
import { ACTIVITY_KINDS, activityEvents, applications, files, notes, submissions, tracks, type NewActivityEvent } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let appId: number;
const mkNote = (body = "called them", application = appId) => db.insert(notes).values({ userId: "local", applicationId: application, body }).returning().get();
const mkEvent = (over: Partial<NewActivityEvent> = {}) =>
  db.insert(activityEvents).values({ userId: "local", applicationId: appId, kind: "status_changed", ...over }).returning().get();
const mkFile = () =>
  db.insert(files).values({
    userId: "local", applicationId: appId, label: "CV", originalName: "cv.docx", storedName: "CV_1.docx", relativePath: "a/CV_1.docx",
    sha256: "a".repeat(64), sizeBytes: 1, uploadDate: "2026-11-10", baseName: "CV", extension: "docx", seq: 1,
  }).returning().get();
const mkSub = () => db.insert(submissions).values({ userId: "local", applicationId: appId, date: "2026-11-10" }).returning().get();

beforeEach(() => {
  db = useTestDb();
  const trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
});
afterEach(dropTestDb);

describe("notes and activity_events tables", () => {
  it("exist with their indexes", () => {
    const names = (t: string) => db.all<{ name: string }>(sql`select name from pragma_index_list(${t})`).map((r) => r.name);
    expect(names("notes")).toContain("notes_application_id_created_at_idx");
    expect(names("activity_events")).toContain("activity_events_application_id_occurred_at_idx");
  });

  it("fill user_id and timestamps, details defaults to an empty JSON object", () => {
    const n = mkNote();
    const e = mkEvent();
    for (const row of [n, e]) {
      expect(row.userId).toBe("local");
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
    expect(e.occurredAt).toBeInstanceOf(Date);
    expect(e.details).toBe("{}");
    expect(e.fileId).toBeNull();
    expect(e.submissionId).toBeNull();
  });

  it("reject an empty or blank note body", () => {
    expect(() => mkNote("")).toThrow(/CHECK/);
    expect(() => mkNote("  \n\t ")).toThrow(/CHECK/);
  });

  it("accept every allowed kind and reject an unknown one", () => {
    for (const kind of ACTIVITY_KINDS) expect(() => mkEvent({ kind })).not.toThrow();
    expect(() => mkEvent({ kind: "bogus" as never })).toThrow(/CHECK/);
  });

  it("reject rows for a missing application", () => {
    expect(() => mkNote("x", 9999)).toThrow(/FOREIGN KEY/);
    expect(() => mkEvent({ applicationId: 9999 })).toThrow(/FOREIGN KEY/);
  });

  it("deleting the application removes its notes and events only", () => {
    const trackId = db.select().from(applications).get()!.trackId;
    const other = db.insert(applications).values({ userId: "local", trackId, title: "B" }).returning().get().id;
    mkNote();
    mkEvent({ fileId: mkFile().id });
    mkNote("keep", other);
    db.insert(activityEvents).values({ userId: "local", applicationId: other, kind: "file_uploaded" }).run();
    db.delete(applications).where(eq(applications.id, appId)).run();
    expect(db.select().from(notes).all().map((n) => n.applicationId)).toEqual([other]);
    expect(db.select().from(activityEvents).all().map((e) => e.applicationId)).toEqual([other]);
  });

  it("an event survives deleting its file or submission, link cleared and snapshot intact", () => {
    const f = mkFile();
    const s = mkSub();
    const snap = JSON.stringify({ originalName: "cv.docx", storedName: "CV_1.docx", fileId: f.id });
    const fe = mkEvent({ kind: "file_uploaded", fileId: f.id, details: snap });
    const se = mkEvent({ kind: "submission_created", submissionId: s.id, details: JSON.stringify({ date: "2026-11-10", fileCount: 0 }) });
    db.delete(files).where(eq(files.id, f.id)).run();
    db.delete(submissions).where(eq(submissions.id, s.id)).run();
    const after = (id: number) => db.select().from(activityEvents).where(eq(activityEvents.id, id)).get()!;
    expect(after(fe.id)).toMatchObject({ fileId: null, details: snap });
    expect(after(se.id)).toMatchObject({ submissionId: null, details: JSON.stringify({ date: "2026-11-10", fileCount: 0 }) });
  });
});

describe("delete impact with notes", () => {
  it("counts the application's notes, not its events, and deleteApplication refuses when the note count changed", async () => {
    expect((await getDeleteImpact(appId))?.noteCount).toBe(0);
    mkNote();
    mkNote("again");
    mkEvent();
    expect((await getDeleteImpact(appId))?.noteCount).toBe(2);
    const shown = { cellCount: 0, fileCount: 0, submissionCount: 0 };
    expect(await deleteApplication(appId, { ...shown, noteCount: 1 })).toMatchObject({ ok: false });
    expect(db.select().from(notes).all()).toHaveLength(2);
    expect(await deleteApplication(appId, { ...shown, noteCount: 2 })).toMatchObject({ ok: true });
    expect(db.select().from(notes).all()).toEqual([]);
    expect(db.select().from(activityEvents).all()).toEqual([]);
  });
});

describe("migration 0002 on a database with data", () => {
  it("applies on top of 0001 and leaves existing rows untouched", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "dossier-mig-"));
    try {
      cpSync("./drizzle", join(dir, "old"), { recursive: true });
      const journalPath = join(dir, "old/meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.slice(0, 2); // 0000 and 0001 only
      writeFileSync(journalPath, JSON.stringify(journal));
      process.env.DATABASE_PATH = join(dir, "t.db");
      migrate(getDb(), { migrationsFolder: join(dir, "old") });
      const t = getDb().insert(tracks).values({ userId: "local", name: "Keep", position: 0 }).returning().get().id;
      const a = getDb().insert(applications).values({ userId: "local", trackId: t, title: "Keep me" }).returning().get().id;
      getDb().insert(submissions).values({ userId: "local", applicationId: a, date: "2026-11-10" }).run();
      expect(getDb().all(sql`select name from sqlite_master where name in ('notes','activity_events')`)).toEqual([]);

      migrate(getDb(), { migrationsFolder: "./drizzle" });
      expect(getDb().select().from(applications).all().map((x) => x.title)).toEqual(["Keep me"]);
      expect(getDb().select().from(submissions).all()).toHaveLength(1);
      expect(getDb().all(sql`select name from sqlite_master where name in ('notes','activity_events')`)).toHaveLength(2);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
