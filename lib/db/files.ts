// Server-only. See lib/db/tracks.ts for the convention. Read helpers for the application folder rule (5.4).
import { and, eq, ne } from "drizzle-orm";
import { dirname } from "node:path/posix";
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

export type NewFileRow = Omit<typeof files.$inferInsert, "id" | "userId" | "createdAt" | "updatedAt">;

// Throws on a unique violation (counter or path taken: the caller picks the next seq) or a foreign key violation (application gone).
export async function insertFileRow(row: NewFileRow): Promise<number> {
  return getDb().insert(files).values({ ...row, userId: getUserId() }).returning({ id: files.id }).get().id;
}
