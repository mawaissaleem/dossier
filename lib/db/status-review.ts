// Server-only. See lib/db/tracks.ts for the convention. The one server-side "needs review" rule (FR-7.2), shared by every way a status can change.
import { and, count, eq } from "drizzle-orm";
import { needsSubmissionReview } from "../submission-review";
import type { getDb } from "./client";
import { cellValues, submissions } from "./schema";
import { submittedStatusIds } from "./track-settings";

// Synchronous, so a caller can check and write with nothing in between. Reads current state through `db` (the connection or a transaction).
export function statusNeedsReview(db: Pick<ReturnType<typeof getDb>, "select">, userId: string, a: { applicationId: number; trackId: number; column: { id: number; isStatus: boolean }; optionId: number | null }): boolean {
  if (!a.column.isStatus || a.optionId === null) return false; // the common case does no further reads
  const current = db.select({ v: cellValues.valueOptionId }).from(cellValues)
    .where(and(eq(cellValues.applicationId, a.applicationId), eq(cellValues.columnId, a.column.id), eq(cellValues.userId, userId))).get();
  const { n } = db.select({ n: count() }).from(submissions).where(and(eq(submissions.applicationId, a.applicationId), eq(submissions.userId, userId))).get()!;
  return needsSubmissionReview({ isStatus: true, optionId: a.optionId, currentOptionId: current?.v ?? null, submittedIds: submittedStatusIds(a.trackId), submissionCount: n });
}
