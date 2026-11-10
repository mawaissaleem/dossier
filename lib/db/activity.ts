// Server-only. See lib/db/tracks.ts for the convention. The automatic log of an application (FR-11.2). Every writer takes the CALLER'S
// transaction, so the change and its event commit or roll back together. History starts with this task: nothing is backfilled.
import { and, desc, eq, inArray } from "drizzle-orm";
import { buildActivityDetails, parseActivityDetails, type ActivityDetails } from "../activity";
import { getDb } from "./client";
import { activityEvents, cellValues, columnOptions, columns, type ActivityKind } from "./schema";
import { getUserId } from "./user";

type Db = Pick<ReturnType<typeof getDb>, "select" | "insert">;
type OptionRef = { id: number; label: string } | null;

export function insertEvent(
  tx: Pick<ReturnType<typeof getDb>, "insert">, userId: string, applicationId: number, occurredAt: Date,
  details: Exclude<ActivityDetails, { kind: "unknown" }>, links: { fileId?: number; submissionId?: number } = {},
) {
  tx.insert(activityEvents).values({ userId, applicationId, kind: details.kind, occurredAt, details: buildActivityDetails(details), ...links }).run();
}

export function insertStatusEvent(tx: Pick<ReturnType<typeof getDb>, "insert">, userId: string, applicationId: number, columnId: number, from: OptionRef, to: OptionRef) {
  insertEvent(tx, userId, applicationId, new Date(), {
    kind: "status_changed", columnId, fromOptionId: from?.id ?? null, fromLabel: from?.label ?? null, toOptionId: to?.id ?? null, toLabel: to?.label ?? null,
  });
}

// Call BEFORE the cell is written: reads the current value, and logs from -> to when the column is a status column and the value really
// changes (null = blank). Switching which column is the status column (2.9) is not a value change and logs nothing.
export function logStatusChange(tx: Db, userId: string, applicationId: number, columnId: number, toOptionId: number | null) {
  if (!tx.select({ id: columns.id }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId), eq(columns.isStatus, true))).get()) return;
  const from = tx.select({ v: cellValues.valueOptionId }).from(cellValues)
    .where(and(eq(cellValues.applicationId, applicationId), eq(cellValues.columnId, columnId), eq(cellValues.userId, userId))).get()?.v ?? null;
  if (from === toOptionId) return;
  const ids = [from, toOptionId].filter((x): x is number => x !== null);
  const labels = new Map(tx.select({ id: columnOptions.id, label: columnOptions.label }).from(columnOptions)
    .where(and(inArray(columnOptions.id, ids), eq(columnOptions.userId, userId))).all().map((o) => [o.id, o.label]));
  const ref = (id: number | null): OptionRef => (id === null ? null : { id, label: labels.get(id) ?? "" });
  insertStatusEvent(tx, userId, applicationId, columnId, ref(from), ref(toOptionId));
}

export type ActivityItem = { id: number; kind: ActivityKind; occurredAt: Date; fileId: number | null; submissionId: number | null; details: ActivityDetails };

// Newest first (occurred_at, then id: events of one moment keep their write order, latest on top). For the 7.4 timeline.
export async function listActivity(applicationId: number): Promise<ActivityItem[]> {
  return getDb().select().from(activityEvents)
    .where(and(eq(activityEvents.applicationId, applicationId), eq(activityEvents.userId, getUserId())))
    .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).all()
    .map((e) => ({ id: e.id, kind: e.kind, occurredAt: e.occurredAt, fileId: e.fileId, submissionId: e.submissionId, details: parseActivityDetails(e.kind, e.details) }));
}
