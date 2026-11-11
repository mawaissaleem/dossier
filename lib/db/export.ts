// Server-only. See lib/db/tracks.ts for the convention.
import { and, desc, eq } from "drizzle-orm";
import { readCell, type CellScalar } from "../cells";
import { getDb } from "./client";
import { listColumns, type ColumnItem } from "./columns";
import { applications, cellValues, tracks } from "./schema";
import { getUserId } from "./user";

export type ExportRow = { id: number; title: string; archived: boolean; values: Record<number, CellScalar | null> };

// Everything the CSV export needs for one track of the current user: every column (hidden too, display order) and every application,
// archived included, newest first (the table's default order). Null if the track is missing or not the user's.
// Separate from listApplicationRows, which skips archived applications on purpose (the table), so its callers stay unchanged.
export async function getTrackExport(trackId: number): Promise<{ trackName: string; columns: ColumnItem[]; rows: ExportRow[] } | null> {
  const db = getDb();
  const userId = getUserId();
  const track = db.select({ name: tracks.name }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, userId))).get();
  if (!track) return null;
  const columns = await listColumns(trackId);
  const type = new Map(columns.map((c) => [c.id, c.type]));
  const rows = db.select({ id: applications.id, title: applications.title, archived: applications.archived }).from(applications)
    .where(and(eq(applications.trackId, trackId), eq(applications.userId, userId))).orderBy(desc(applications.id)).all()
    .map((a) => ({ ...a, values: Object.fromEntries(columns.map((c) => [c.id, null])) as ExportRow["values"] }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cells = db.select({ cell: cellValues }).from(cellValues).innerJoin(applications, eq(applications.id, cellValues.applicationId))
    .where(and(eq(applications.trackId, trackId), eq(applications.userId, userId), eq(cellValues.userId, userId))).all();
  for (const { cell } of cells) {
    const t = type.get(cell.columnId);
    if (t) byId.get(cell.applicationId)!.values[cell.columnId] = readCell(t, cell);
  }
  return { trackName: track.name, columns, rows };
}
