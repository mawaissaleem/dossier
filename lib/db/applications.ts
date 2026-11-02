// Server-only. See lib/db/tracks.ts for the convention.
import { and, count, desc, eq } from "drizzle-orm";
import { readCell, type CellScalar } from "../cells";
import { getDb } from "./client";
import { listColumns, type ColumnItem } from "./columns";
import { applications, cellValues, tracks } from "./schema";
import { getUserId } from "./user";

// Returns the new id, or null (nothing inserted) if the track does not exist or is not the current user's.
// No await between the check and the insert, and better-sqlite3 is sync, so nothing can interleave.
export async function createApplication({ title, trackId }: { title: string; trackId: number }): Promise<number | null> {
  const db = getDb();
  const userId = getUserId();
  const track = db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, userId))).get();
  if (!track) return null;
  return db.insert(applications).values({ userId, trackId, title }).returning({ id: applications.id }).get().id;
}

export type ApplicationListItem = { id: number; title: string };

// Non-archived applications of the current user's track, newest first (id breaks ties).
export async function listApplications(trackId: number): Promise<ApplicationListItem[]> {
  return getDb()
    .select({ id: applications.id, title: applications.title })
    .from(applications)
    .where(and(eq(applications.trackId, trackId), eq(applications.userId, getUserId()), eq(applications.archived, false)))
    .orderBy(desc(applications.id))
    .all();
}

export type ApplicationRow = { id: number; title: string; values: Record<number, CellScalar | null> };

// Same rows and order as listApplications, each with every column of the track as a key (null = blank, FR-2.1).
// Fixed 4 queries (columns, options, applications, cell values), pivoted in JS: one pass over the cell rows into a
// per-application map is simpler than a SQL pivot, which would need a dynamic CASE per column.
// Pass `cols` (from listColumns) to reuse an already-loaded column list instead of querying it again.
export async function listApplicationRows(trackId: number, cols?: ColumnItem[]): Promise<ApplicationRow[]> {
  const db = getDb();
  const userId = getUserId();
  cols ??= await listColumns(trackId);
  const apps = await listApplications(trackId);
  if (apps.length === 0) return [];
  const type = new Map(cols.map((c) => [c.id, c.type]));
  const byApp = new Map<number, Record<number, CellScalar | null>>(
    apps.map((a) => [a.id, Object.fromEntries(cols.map((c) => [c.id, null]))]),
  );
  const cells = db
    .select({ cell: cellValues })
    .from(cellValues)
    .innerJoin(applications, eq(applications.id, cellValues.applicationId))
    .where(and(eq(applications.trackId, trackId), eq(applications.archived, false), eq(applications.userId, userId), eq(cellValues.userId, userId)))
    .all();
  for (const { cell } of cells) {
    const t = type.get(cell.columnId);
    if (t) byApp.get(cell.applicationId)![cell.columnId] = readCell(t, cell); // skips cells of columns outside this track
  }
  return apps.map((a) => ({ ...a, values: byApp.get(a.id)! }));
}

export type ApplicationDetail = {
  id: number;
  title: string;
  archived: boolean;
  track: { id: number; name: string };
  columns: ColumnItem[]; // all of the track's columns in position order, hidden included
  values: Record<number, CellScalar | null>; // every column id is a key (null = blank)
};

// Null if missing or not the current user's. Archived applications are returned (direct URL still works).
// Fixed 4 queries: application + track (one join), columns, options, cell values.
export async function getApplicationDetail(id: number): Promise<ApplicationDetail | null> {
  const db = getDb();
  const userId = getUserId();
  const row = db
    .select({ id: applications.id, title: applications.title, archived: applications.archived, trackId: tracks.id, trackName: tracks.name })
    .from(applications)
    .innerJoin(tracks, and(eq(tracks.id, applications.trackId), eq(tracks.userId, userId)))
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .get();
  if (!row) return null;
  const cols = await listColumns(row.trackId);
  const type = new Map(cols.map((c) => [c.id, c.type]));
  const values: Record<number, CellScalar | null> = Object.fromEntries(cols.map((c) => [c.id, null]));
  const cells = db.select().from(cellValues).where(and(eq(cellValues.applicationId, id), eq(cellValues.userId, userId))).all();
  for (const cell of cells) {
    const t = type.get(cell.columnId);
    if (t) values[cell.columnId] = readCell(t, cell);
  }
  return { id: row.id, title: row.title, archived: row.archived, track: { id: row.trackId, name: row.trackName }, columns: cols, values };
}

// True if the current user's application exists (also when the flag already had that value). Reversible, so no confirmation.
export async function archiveApplication(id: number, archived: boolean): Promise<boolean> {
  return getDb().update(applications).set({ archived }).where(and(eq(applications.id, id), eq(applications.userId, getUserId()))).run().changes > 0;
}

// shortcut: no files exist until phase 5, so this is 0. Phase 5 must count the application's stored files here, so the
// delete confirmation already says the final thing and the delete removes them too.
async function countApplicationFiles(applicationId: number): Promise<number> {
  void applicationId;
  return 0;
}

export type DeleteImpact = { title: string; cellCount: number; fileCount: number };

// What deleting would lose: stored cell values (a blank cell has no row, FR-1.4) and files. Null if missing or not the current user's.
export async function getDeleteImpact(id: number): Promise<DeleteImpact | null> {
  const db = getDb();
  const userId = getUserId();
  const app = db.select({ title: applications.title }).from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).get();
  if (!app) return null;
  const { n } = db.select({ n: count() }).from(cellValues).where(and(eq(cellValues.applicationId, id), eq(cellValues.userId, userId))).get()!;
  return { title: app.title, cellCount: n, fileCount: await countApplicationFiles(id) };
}

// Returns the application's track id (for the redirect), or null if missing or not the current user's (nothing deleted).
// Cell values go with it via ON DELETE CASCADE (foreign_keys is on, see client.ts). Callers must have confirmed with the user.
export async function deleteApplication(id: number): Promise<number | null> {
  const db = getDb();
  return db.transaction((tx) =>
    tx.delete(applications).where(and(eq(applications.id, id), eq(applications.userId, getUserId()))).returning({ trackId: applications.trackId }).get()?.trackId ?? null,
  );
}
