// Server-only. See lib/db/tracks.ts for the convention. Read helpers for the application folder rule (5.4).
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { dirname } from "node:path/posix";
import { insertEvent } from "./activity";
import { getDb } from "./client";
import { applications, cellValues, columns, files, tracks } from "./schema";
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
// Starts with application_id, so files_counter_uniq serves the lookup.
export async function getCounterEntries(applicationId: number) {
  return getDb().select({ baseName: files.baseName, uploadDate: files.uploadDate, extension: files.extension, seq: files.seq }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()))).all();
}

export async function applicationExists(applicationId: number): Promise<boolean> {
  return !!getDb().select({ id: applications.id }).from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, getUserId()))).get();
}

// The earliest file of this application with this SHA-256 (FR-5.7; served by files_application_id_sha256_idx), or null.
export async function findFileByHash(applicationId: number, sha256: string): Promise<{ id: number; storedName: string } | null> {
  return getDb().select({ id: files.id, storedName: files.storedName }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.sha256, sha256), eq(files.userId, getUserId()))).orderBy(files.id).limit(1).get() ?? null;
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

export type FileListItem = { id: number; originalName: string; storedName: string; label: string; uploadDate: string; sizeBytes: number };

// The application's uploaded files for the detail page: DB rows only (FR-5.11), newest upload date first, then the counter.
export async function listApplicationFiles(applicationId: number): Promise<FileListItem[]> {
  return getDb().select({ id: files.id, originalName: files.originalName, storedName: files.storedName, label: files.label, uploadDate: files.uploadDate, sizeBytes: files.sizeBytes }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId())))
    .orderBy(desc(files.uploadDate), asc(files.seq), asc(files.id)).all();
}

// The row behind Open, by id and user. The path comes from here, never from the request.
export async function getFileForOpen(id: number): Promise<{ storedName: string; relativePath: string } | null> {
  return getDb().select({ storedName: files.storedName, relativePath: files.relativePath }).from(files)
    .where(and(eq(files.id, id), eq(files.userId, getUserId()))).get() ?? null;
}

// Relative paths of every stored file of the application. Read before deleting it: the rows (and these paths) go with the delete.
export async function listApplicationFilePaths(applicationId: number): Promise<string[]> {
  return getDb().select({ p: files.relativePath }).from(files)
    .where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()))).all().map((r) => r.p);
}
