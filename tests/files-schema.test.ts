import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { deleteApplication, getDeleteImpact } from "@/lib/db/applications";
import { applications, files, submissionFiles, submissions, tracks, type NewStoredFile } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let appId: number;
const HASH = "a".repeat(64);
let n = 0;
const fileRow = (over: Partial<NewStoredFile> = {}): NewStoredFile => {
  n++;
  return {
    userId: "local", applicationId: appId, label: "CV", originalName: "cv.docx", storedName: `CV_${n}.docx`,
    relativePath: `job/app/CV_${n}.docx`, sha256: HASH, sizeBytes: 10, uploadDate: "2026-11-08", baseName: "CV", extension: "docx", seq: n,
    ...over,
  };
};
const mkFile = (over: Partial<NewStoredFile> = {}) => db.insert(files).values(fileRow(over)).returning().get();
const mkSub = (application = appId) => db.insert(submissions).values({ userId: "local", applicationId: application, date: "2026-11-09" }).returning().get();
const link = (submissionId: number, fileId: number) => db.insert(submissionFiles).values({ userId: "local", submissionId, fileId }).run();

beforeEach(() => {
  db = useTestDb();
  const trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
});
afterEach(dropTestDb);

describe("files, submissions, submission_files tables", () => {
  it("exist with their indexes", () => {
    const names = (t: string) => db.all<{ name: string }>(sql`select name from pragma_index_list(${t})`).map((r) => r.name);
    expect(names("files")).toEqual(expect.arrayContaining(["files_application_id_sha256_idx", "files_user_id_relative_path_uniq", "files_counter_uniq"]));
    expect(names("submissions")).toContain("submissions_application_id_date_idx");
    expect(names("submission_files")).toContain("submission_files_submission_id_file_id_uniq");
  });

  it("fill id, user_id and timestamps", () => {
    const f = mkFile();
    const s = mkSub();
    link(s.id, f.id);
    const l = db.select().from(submissionFiles).get()!;
    for (const row of [f, s, l]) {
      expect(row.userId).toBe("local");
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
    expect(s.note).toBeNull();
  });

  it("reject bad hash, negative size and seq below 1", () => {
    for (const bad of [{ sha256: "a".repeat(63) }, { sha256: "A".repeat(64) }, { sha256: "g".repeat(64) }, { sizeBytes: -1 }, { seq: 0 }]) {
      expect(() => mkFile(bad)).toThrow();
    }
    expect(() => mkFile({ sizeBytes: 0 })).not.toThrow();
  });

  it("reject a duplicate relative path per user and a duplicate counter, but allow other extensions and users", () => {
    mkFile({ relativePath: "x/CV_01.docx", seq: 1 });
    expect(() => mkFile({ relativePath: "x/CV_01.docx", seq: 2 })).toThrow();
    expect(() => mkFile({ relativePath: "x/other.docx", seq: 1 })).toThrow(); // same app, date, base, extension, seq
    expect(() => mkFile({ relativePath: "x/CV_01.pdf", extension: "pdf", seq: 1 })).not.toThrow(); // FR-6.2
    const other = db.insert(tracks).values({ userId: "other", name: "T", position: 0 }).returning().get().id;
    const otherApp = db.insert(applications).values({ userId: "other", trackId: other, title: "B" }).returning().get().id;
    expect(() => db.insert(files).values(fileRow({ userId: "other", applicationId: otherApp, relativePath: "x/CV_01.docx", seq: 1 })).run()).not.toThrow();
  });

  it("reject linking the same file to the same submission twice, allow one file in two submissions (FR-7.5)", () => {
    const f = mkFile();
    const s1 = mkSub();
    const s2 = mkSub();
    link(s1.id, f.id);
    expect(() => link(s1.id, f.id)).toThrow();
    expect(() => link(s2.id, f.id)).not.toThrow();
  });

  it("reject rows pointing at a missing application, submission or file", () => {
    expect(() => mkFile({ applicationId: 9999 })).toThrow();
    expect(() => mkSub(9999)).toThrow();
    expect(() => link(9999, mkFile().id)).toThrow();
    expect(() => link(mkSub().id, 9999)).toThrow();
  });
});

describe("delete behaviour", () => {
  it("deleting a submission removes its links but keeps the file", () => {
    const f = mkFile();
    const s = mkSub();
    link(s.id, f.id);
    db.delete(submissions).where(eq(submissions.id, s.id)).run();
    expect(db.select().from(submissionFiles).all()).toEqual([]);
    expect(db.select().from(files).all()).toHaveLength(1);
  });

  it("deleting a file that belongs to a submission fails and changes nothing (FR-5.8)", () => {
    const f = mkFile();
    link(mkSub().id, f.id);
    expect(() => db.delete(files).where(eq(files.id, f.id)).run()).toThrow(/FOREIGN KEY/);
    expect(db.select().from(files).all()).toHaveLength(1);
    expect(db.select().from(submissionFiles).all()).toHaveLength(1);
  });

  it("deleting a file in no submission works", () => {
    const f = mkFile();
    db.delete(files).where(eq(files.id, f.id)).run();
    expect(db.select().from(files).all()).toEqual([]);
  });

  it("deleting the application removes its files, submissions and links, even when a file is in a submission", () => {
    const f = mkFile();
    link(mkSub().id, f.id);
    db.delete(applications).where(eq(applications.id, appId)).run();
    expect(db.select().from(files).all()).toEqual([]);
    expect(db.select().from(submissions).all()).toEqual([]);
    expect(db.select().from(submissionFiles).all()).toEqual([]);
  });

  it("delete impact counts the application's files, and deleteApplication guards on that count", async () => {
    expect((await getDeleteImpact(appId))?.fileCount).toBe(0);
    const f = mkFile();
    mkFile();
    link(mkSub().id, f.id);
    const trackId = db.select().from(applications).get()!.trackId;
    const otherApp = db.insert(applications).values({ userId: "local", trackId, title: "B" }).returning().get().id;
    mkFile({ applicationId: otherApp }); // not counted
    expect((await getDeleteImpact(appId))?.fileCount).toBe(2);
    expect((await deleteApplication(appId, { cellCount: 0, fileCount: 0, submissionCount: 1 })).ok).toBe(false);
    expect((await deleteApplication(appId, { cellCount: 0, fileCount: 2, submissionCount: 1 })).ok).toBe(true);
    expect(db.select().from(files).all().map((x) => x.applicationId)).toEqual([otherApp]);
  });
});

describe("migration 0001 on a database with data", () => {
  it("applies on top of 0000 and leaves existing rows untouched", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "dossier-mig-"));
    try {
      // Copy of ./drizzle holding only the first migration.
      cpSync("./drizzle", join(dir, "old"), { recursive: true });
      const journalPath = join(dir, "old/meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.slice(0, 1);
      writeFileSync(journalPath, JSON.stringify(journal));
      process.env.DATABASE_PATH = join(dir, "t.db");
      migrate(getDb(), { migrationsFolder: join(dir, "old") });
      const t = getDb().insert(tracks).values({ userId: "local", name: "Keep", position: 0 }).returning().get().id;
      getDb().insert(applications).values({ userId: "local", trackId: t, title: "Keep me" }).run();
      expect(getDb().all(sql`select name from sqlite_master where name = 'files'`)).toEqual([]);

      migrate(getDb(), { migrationsFolder: "./drizzle" });
      expect(getDb().select().from(applications).all().map((a) => a.title)).toEqual(["Keep me"]);
      expect(getDb().all(sql`select name from sqlite_master where name in ('files','submissions','submission_files')`)).toHaveLength(3);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
