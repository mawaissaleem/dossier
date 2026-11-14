// Server-only. FR-9.7: applications whose current status is one of their track's win statuses (`track.<id>.win_statuses`, lib/db/track-settings.ts).
import { and, eq, inArray, sql } from "drizzle-orm";
import { orderWins, type Win } from "../wins";
import { getDb } from "./client";
import { activityEvents, applications, cellValues, columns } from "./schema";
import { statusOptions, winStatusIds } from "./track-settings";
import { listTracks } from "./tracks";
import { getUserId } from "./user";

// `labels` = every configured win status label in track and option order (the card is shown, with an empty state, as long as there is one);
// `wins` = most recently reached first, archived ones included. `since` = the newest status change into the current status, else the application's updated_at.
export async function getWins(): Promise<{ labels: string[]; wins: Win[] }> {
  const db = getDb();
  const userId = getUserId();
  const byOption = new Map<number, { label: string; color: string; trackId: number; trackName: string }>();
  const labels: string[] = [];
  for (const t of await listTracks()) {
    const win = new Set(winStatusIds(t.id));
    for (const o of statusOptions(t.id)) if (win.has(o.id)) { byOption.set(o.id, { label: o.label, color: o.color, trackId: t.id, trackName: t.name }); labels.push(o.label); }
  }
  if (!byOption.size) return { labels, wins: [] };
  // json_valid first: json_extract throws on a garbled `details`, and one bad event must not take the dashboard down.
  const since = sql<number>`coalesce((select max(${activityEvents.occurredAt}) from ${activityEvents}
    where ${activityEvents.applicationId} = ${applications.id} and ${activityEvents.userId} = ${userId} and ${activityEvents.kind} = 'status_changed'
    and case when json_valid(${activityEvents.details}) then json_extract(${activityEvents.details}, '$.columnId') end = ${cellValues.columnId}
    and case when json_valid(${activityEvents.details}) then json_extract(${activityEvents.details}, '$.toOptionId') end = ${cellValues.valueOptionId}), ${applications.updatedAt})`;
  const rows = db
    .select({ id: applications.id, title: applications.title, trackId: applications.trackId, archived: applications.archived, optionId: cellValues.valueOptionId, since })
    .from(applications)
    .innerJoin(columns, and(eq(columns.trackId, applications.trackId), eq(columns.isStatus, true), eq(columns.userId, userId)))
    .innerJoin(cellValues, and(eq(cellValues.applicationId, applications.id), eq(cellValues.columnId, columns.id), eq(cellValues.userId, userId)))
    .where(and(eq(applications.userId, userId), inArray(cellValues.valueOptionId, [...byOption.keys()])))
    .all();
  const wins = rows.flatMap((r) => {
    const o = byOption.get(r.optionId!);
    return o && o.trackId === r.trackId ? [{ id: r.id, title: r.title, trackId: o.trackId, trackName: o.trackName, label: o.label, color: o.color, archived: r.archived, since: Number(r.since) }] : [];
  });
  return { labels, wins: orderWins(wins) };
}
