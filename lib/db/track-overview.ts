// Server-only. What the dashboard's track cards and the /tracks panels show, for every track, in a fixed number of queries (none per application).
import { and, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { trackOverview, type OverviewApp, type TrackOverview } from "../track-overview";
import { getDb } from "./client";
import { getPipelineCounts } from "./pipeline";
import { datedStillToDo, lastTouchedMs, stillToDoIds } from "./planner";
import { applications, cellValues, columns, submissions } from "./schema";
import { submittedStatusIds, winStatusIds } from "./track-settings";
import { getUserId } from "./user";

// Non-archived applications only. Reads: the pipeline (counts, status column), one query for every application's status, one grouped query for first submissions,
// the planner's last-touched map and its still-to-do gathering (deadlines; both shared with the dashboard's other cards), plus three settings per track.
// React `cache` = once per request (the /tracks header and its panels share it); `nowMs` is not part of the key.
export const getTrackOverviews = cache(async (today: string, nowMs: number = Date.now()): Promise<TrackOverview[]> => {
  const db = getDb();
  const userId = getUserId();
  const pipelines = await getPipelineCounts();
  const rows = db
    .select({ id: applications.id, title: applications.title, trackId: applications.trackId, statusId: cellValues.valueOptionId })
    .from(applications)
    .leftJoin(columns, and(eq(columns.trackId, applications.trackId), eq(columns.isStatus, true), eq(columns.userId, userId)))
    .leftJoin(cellValues, and(eq(cellValues.applicationId, applications.id), eq(cellValues.columnId, columns.id), eq(cellValues.userId, userId)))
    .where(and(eq(applications.userId, userId), eq(applications.archived, false)))
    .all();
  const first = new Map(db.select({ id: submissions.applicationId, first: sql<string>`min(${submissions.date})` }).from(submissions).where(eq(submissions.userId, userId)).groupBy(submissions.applicationId).all().map((r) => [r.id, r.first]));
  const touched = lastTouchedMs();
  const deadlines = new Map(datedStillToDo().map((a) => [a.id, a.deadline as string | null]));
  const byTrack = new Map<number, OverviewApp[]>();
  for (const r of rows) {
    const list = byTrack.get(r.trackId) ?? [];
    list.push({ id: r.id, title: r.title, statusId: r.statusId, touchedMs: touched.get(r.id) ?? 0, deadline: deadlines.get(r.id) ?? null, firstSubmitted: first.get(r.id) ?? null });
    byTrack.set(r.trackId, list);
  }
  return pipelines.map((pipeline) => trackOverview(
    { pipeline, todoIds: stillToDoIds(pipeline.id), submittedIds: submittedStatusIds(pipeline.id), winIds: winStatusIds(pipeline.id), apps: byTrack.get(pipeline.id) ?? [] },
    today, nowMs,
  ));
});
