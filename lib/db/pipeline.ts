// Server-only. FR-9.6: how many applications sit in each status, per track.
import { and, asc, eq, sql } from "drizzle-orm";
import { pipelineCounts, type TrackPipeline } from "../pipeline";
import { getDb } from "./client";
import { applications, cellValues, columns } from "./schema";
import { statusOptions } from "./track-settings";
import { listTracks } from "./tracks";
import { getUserId } from "./user";

// One grouped query over the user's non-archived applications, joined to each track's status column (`columns.is_status`) and the
// application's value in it; labels, colours and order come from `column_options` (statusOptions), so a rename shows at once. A track
// with no status column is not skipped: it gets its total and no segments. Tracks keep their own order; one with no applications has total 0.
export async function getPipelineCounts(): Promise<TrackPipeline[]> {
  const db = getDb();
  const userId = getUserId();
  const rows = db
    .select({ trackId: applications.trackId, optionId: cellValues.valueOptionId, n: sql<number>`count(*)` })
    .from(applications)
    .leftJoin(columns, and(eq(columns.trackId, applications.trackId), eq(columns.isStatus, true), eq(columns.userId, userId)))
    .leftJoin(cellValues, and(eq(cellValues.applicationId, applications.id), eq(cellValues.columnId, columns.id), eq(cellValues.userId, userId)))
    .where(and(eq(applications.userId, userId), eq(applications.archived, false)))
    .groupBy(applications.trackId, cellValues.valueOptionId)
    .all();
  const statusCols = new Map(
    db.select({ id: columns.id, trackId: columns.trackId }).from(columns).where(and(eq(columns.userId, userId), eq(columns.isStatus, true))).orderBy(asc(columns.id)).all().map((c) => [c.trackId, c.id]),
  );
  const tracks = (await listTracks()).map((t) => ({ id: t.id, name: t.name, color: t.color, statusColumnId: statusCols.get(t.id) ?? null, options: statusOptions(t.id) }));
  return pipelineCounts(rows, tracks);
}
