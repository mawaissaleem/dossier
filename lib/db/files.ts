// Server-only. See lib/db/tracks.ts for the convention. Read helpers for the application folder rule (5.4).
import { and, asc, count, desc, eq, isNull, ne } from "drizzle-orm";
import { dirname } from "node:path/posix";
import { parseActivityDetails } from "../activity";
import type { CounterEntry } from "../filename";
import { insertEvent } from "./activity";
import { getDb } from "./client";
import { activityEvents, applications, cellValues, columns, files, submissionFiles, submissions, tracks, type IntegrityState } from "./schema";
import { sameFiles, type LiveFile } from "../relocate";
import { setFilesRoot } from "./settings";
import { getUserId } from "./user";

// The folder of an application's existing files (stored paths are relative, forward slashes), or null before its first upload.
export async function getApplicationFolder(applicationId: number): Promise<string | null> {
  const row = getDb().select({ p: files.relativePath }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()))).orderBy(files.id).limit(1).get();
  return row ? dirname(row.p) : null;
}

// Folders already used by OTHER applications' files.
export async function getUsedFolders(exceptApplicationId: number): Promise<string[]> {
  const rows = getDb().select({ p: files.relativePath }).from(files)
    .where(and(ne(files.applicationId, exceptApplicationId), eq(files.userId, getUserId()))).all();
  return [...new Set(rows.map((r) => dirname(r.p)))];
}

// Everything the folder-name rule reads: title, track name and the application's text cells (name + value, blank = null).
// Hidden columns are included on purpose: hiding a column hides it from the table, but its value is still the application's data.
export async function getFolderNameData(applicationId: number) {
  const db = getDb();
  const userId = getUserId();
  const app = db.select({ title: applications.title, trackName: tracks.name }).from(applications)
    .innerJoin(tracks, eq(tracks.id, applications.trackId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get();
  if (!app) return null;
  const cells = db.select({ name: columns.name, value: cellValues.valueText }).from(columns)
    .innerJoin(applications, eq(applications.trackId, columns.trackId))
    .leftJoin(cellValues, and(eq(cellValues.columnId, columns.id), eq(cellValues.applicationId, applications.id)))
    .where(and(eq(applications.id, applicationId), eq(columns.type, "text"), eq(columns.userId, userId))).all();
  return { ...app, cells };
}

// The application's existing (base name, date, extension, seq) entries for the FR-6.2 counter; feed them to buildStoredName (lib/filename.ts).
// Every deleted file (8.8) keeps its stored name reserved, so no later file carries the name of one in a submission record, the History
// or an older backup: a kept (marked) row is read here like any row, and a dropped row's entry comes from its file_deleted event.
// Starts with application_id, so files_counter_uniq serves the lookup.
export async function getCounterEntries(applicationId: number): Promise<CounterEntry[]> {
  const db = getDb();
  const userId = getUserId();
  const rows = db.select({ baseName: files.baseName, uploadDate: files.uploadDate, extension: files.extension, seq: files.seq }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, userId))).all();
  const deleted = db.select({ details: activityEvents.details }).from(activityEvents)
    .where(and(eq(activityEvents.applicationId, applicationId), eq(activityEvents.userId, userId), eq(activityEvents.kind, "file_deleted"))).all()
    .flatMap((e) => { const d = parseActivityDetails("file_deleted", e.details); return d.kind === "file_deleted" && d.counter ? [d.counter] : []; });
  return [...rows, ...deleted];
}

export async function applicationExists(applicationId: number): Promise<boolean> {
  return !!getDb().select({ id: applications.id }).from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, getUserId()))).get();
}

// The earliest LIVE file of this application with this SHA-256 (FR-5.7; served by files_application_id_sha256_idx), or null.
// A deleted file (8.8) is not a duplicate: its bytes are gone, so the same file can be uploaded again.
export async function findFileByHash(applicationId: number, sha256: string): Promise<{ id: number; storedName: string } | null> {
  return getDb().select({ id: files.id, storedName: files.storedName }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.sha256, sha256), eq(files.userId, getUserId()), isNull(files.deletedAt))).orderBy(files.id).limit(1).get() ?? null;
}

export type NewFileRow = Omit<typeof files.$inferInsert, "id" | "userId" | "createdAt" | "updatedAt">;

// Throws on a unique violation (counter or path taken: the caller picks the next seq) or a foreign key violation (application gone).
// The file_uploaded event (7.3) is written in the same transaction. Its occurred_at is now: the upload date is user-editable and is kept in the details.
export async function insertFileRow(row: NewFileRow): Promise<number> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const id = tx.insert(files).values({ ...row, userId }).returning({ id: files.id }).get().id;
    insertEvent(tx, userId, row.applicationId, new Date(), { kind: "file_uploaded", fileId: id, originalName: row.originalName, storedName: row.storedName, label: row.label, uploadDate: row.uploadDate }, { fileId: id });
    return id;
  });
}

export type FileListItem = { id: number; originalName: string; storedName: string; label: string; uploadDate: string; sizeBytes: number; integrity: IntegrityState; checkedAt: Date | null };

// The application's live uploaded files for the detail page: DB rows only (FR-5.11), deleted ones (8.8) left out, newest upload date first, then the counter.
export async function listApplicationFiles(applicationId: number): Promise<FileListItem[]> {
  return getDb().select({ id: files.id, originalName: files.originalName, storedName: files.storedName, label: files.label, uploadDate: files.uploadDate, sizeBytes: files.sizeBytes, integrity: files.integrity, checkedAt: files.checkedAt }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()), isNull(files.deletedAt)))
    .orderBy(desc(files.uploadDate), asc(files.seq), asc(files.id)).all();
}

// The row behind Open, by id and user. The path comes from here, never from the request. `deleted` (8.8): the bytes are gone on purpose.
export async function getFileForOpen(id: number): Promise<{ storedName: string; relativePath: string; sha256: string; sizeBytes: number; deleted: boolean } | null> {
  const r = getDb().select({ storedName: files.storedName, relativePath: files.relativePath, sha256: files.sha256, sizeBytes: files.sizeBytes, deletedAt: files.deletedAt }).from(files)
    .where(and(eq(files.id, id), eq(files.userId, getUserId()))).get();
  return r ? { storedName: r.storedName, relativePath: r.relativePath, sha256: r.sha256, sizeBytes: r.sizeBytes, deleted: r.deletedAt !== null } : null;
}

// Records the result of a hash check (8.6) so the file list can show it without re-hashing (8.7). A file that matches again goes back to ok.
export async function recordIntegrity(id: number, integrity: IntegrityState): Promise<void> {
  getDb().update(files).set({ integrity, checkedAt: new Date() }).where(and(eq(files.id, id), eq(files.userId, getUserId()))).run();
}

// Ids of the application's live files (this user's), for the on-demand check (8.7). Deleted files (8.8) have nothing to check.
export async function listApplicationFileIds(applicationId: number): Promise<number[]> {
  return getDb().select({ id: files.id }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()), isNull(files.deletedAt))).orderBy(files.id).all().map((r) => r.id);
}

// Relative paths of every live stored file of the application (deleted ones have no bytes). Read before deleting it: the rows (and these paths) go with the delete.
export async function listApplicationFilePaths(applicationId: number): Promise<string[]> {
  return getDb().select({ p: files.relativePath }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()), isNull(files.deletedAt))).all().map((r) => r.p);
}

// ---- Delete one file (8.8, FR-5.8). The steps are driven by lib/files/remove.ts (deleteStoredFile); the order is explained there. ----

export type FileDeleteImpact = { id: number; applicationId: number; originalName: string; storedName: string; label: string; sizeBytes: number; submissions: { id: number; date: string }[] };

// What deleting this live file would lose, for the confirm. Null if missing, already deleted or not this user's. Submissions newest first.
export async function getFileDeleteImpact(id: number): Promise<FileDeleteImpact | null> {
  const db = getDb();
  const userId = getUserId();
  const f = db.select({ id: files.id, applicationId: files.applicationId, originalName: files.originalName, storedName: files.storedName, label: files.label, sizeBytes: files.sizeBytes }).from(files)
    .where(and(eq(files.id, id), eq(files.userId, userId), isNull(files.deletedAt))).get();
  if (!f) return null;
  const subs = db.select({ id: submissions.id, date: submissions.date }).from(submissionFiles).innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
    .where(and(eq(submissionFiles.fileId, id), eq(submissionFiles.userId, userId))).orderBy(desc(submissions.date), desc(submissions.id)).all();
  return { ...f, submissions: subs };
}

export type BeginDeleteResult = { ok: true; relativePath: string } | { ok: false; error: string };

// Step 1: the stale check and the mark in ONE transaction. Once deleted_at is set, no new submission can pick the file (insertSubmission only
// accepts live files), so the count checked here cannot grow afterwards: that is what makes "the file joined a submission" safe to refuse here.
export async function beginFileDelete(id: number, expectedSubmissions: number): Promise<BeginDeleteResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const f = tx.select({ relativePath: files.relativePath }).from(files).where(and(eq(files.id, id), eq(files.userId, userId), isNull(files.deletedAt))).get();
    if (!f) return { ok: false, error: "File not found." };
    const { n } = tx.select({ n: count() }).from(submissionFiles).where(and(eq(submissionFiles.fileId, id), eq(submissionFiles.userId, userId))).get()!;
    if (n !== expectedSubmissions) return { ok: false, error: "This file changed since the warning was shown (a submission now lists it, or no longer does). Check again." };
    tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id)).run();
    return { ok: true, relativePath: f.relativePath };
  });
}

// Undo step 1 when the bytes could not be removed: the file is a normal live file again.
export async function abortFileDelete(id: number): Promise<void> {
  getDb().update(files).set({ deletedAt: null }).where(and(eq(files.id, id), eq(files.userId, getUserId()))).run();
}

// Step 3, after the bytes are gone: one transaction writes the history event and either drops the row (no submission lists it) or leaves
// the marked row as the submissions' record. Returns true when the row was kept.
export async function finishFileDelete(id: number): Promise<boolean> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const f = tx.select().from(files).where(and(eq(files.id, id), eq(files.userId, userId))).get();
    if (!f) return false;
    const { n } = tx.select({ n: count() }).from(submissionFiles).where(and(eq(submissionFiles.fileId, id), eq(submissionFiles.userId, userId))).get()!;
    if (n === 0) tx.delete(files).where(eq(files.id, id)).run(); // the file_uploaded event keeps its snapshot (file_id goes null)
    insertEvent(tx, userId, f.applicationId, new Date(), {
      kind: "file_deleted", fileId: id, originalName: f.originalName, storedName: f.storedName, label: f.label, submissionCount: n,
      counter: { baseName: f.baseName, uploadDate: f.uploadDate, extension: f.extension, seq: f.seq }, // keeps the stored name reserved (getCounterEntries)
    }, n > 0 ? { fileId: id } : {});
    return n > 0;
  });
}

// ---- Relocate the files root (8.10) ----

// Every live file of this user (deleted ones have no bytes), what a move or re-point has to carry or find.
const readLiveFiles = (): LiveFile[] =>
  getDb().select({ id: files.id, relativePath: files.relativePath, sha256: files.sha256, sizeBytes: files.sizeBytes }).from(files)
    .where(and(eq(files.userId, getUserId()), isNull(files.deletedAt))).orderBy(files.id).all();
export const listLiveFiles = async (): Promise<LiveFile[]> => readLiveFiles();

// The switch: saves the new root only if the live files are still exactly `verified` (the set that was copied or found there). All of it runs in one
// tick (better-sqlite3 is sync, nothing is awaited between the read and the write), so no upload or delete can slip in between.
export async function switchFilesRoot(newRoot: string, verified: LiveFile[]): Promise<boolean> {
  if (!sameFiles(readLiveFiles(), verified)) return false;
  const saved = setFilesRoot(newRoot); // its body is synchronous: the write has happened when this returns
  await saved;
  return true;
}
