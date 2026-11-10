// Pure (no DB, no UI). The `details` JSON of an activity event (FR-11.2): one typed shape per kind, a builder and a parser.
// The timeline line is rendered from the parsed details alone, so each shape is a full snapshot (nothing is looked up later).
import type { ActivityKind } from "./db/schema";

export type StatusChangedDetails = { columnId: number; fromOptionId: number | null; fromLabel: string | null; toOptionId: number | null; toLabel: string | null }; // null = blank
export type FileUploadedDetails = { fileId: number; originalName: string; storedName: string; label: string; uploadDate: string };
export type SubmissionCreatedDetails = { submissionId: number; date: string; fileCount: number; fileNames: string[] }; // stored names

export type ActivityDetails =
  | ({ kind: "status_changed" } & StatusChangedDetails)
  | ({ kind: "file_uploaded" } & FileUploadedDetails)
  | ({ kind: "submission_created" } & SubmissionCreatedDetails)
  | { kind: "unknown" }; // garbled or unrecognised JSON: render a generic line

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const orNull = <T>(v: unknown, ok: (x: unknown) => x is T): v is T | null => v === null || ok(v);

function shape(kind: ActivityKind, o: Record<string, unknown>): ActivityDetails | null {
  switch (kind) {
    case "status_changed":
      return isInt(o.columnId) && orNull(o.fromOptionId, isInt) && orNull(o.fromLabel, isStr) && orNull(o.toOptionId, isInt) && orNull(o.toLabel, isStr)
        ? { kind, columnId: o.columnId, fromOptionId: o.fromOptionId, fromLabel: o.fromLabel, toOptionId: o.toOptionId, toLabel: o.toLabel }
        : null;
    case "file_uploaded":
      return isInt(o.fileId) && isStr(o.originalName) && isStr(o.storedName) && isStr(o.label) && isStr(o.uploadDate)
        ? { kind, fileId: o.fileId, originalName: o.originalName, storedName: o.storedName, label: o.label, uploadDate: o.uploadDate }
        : null;
    case "submission_created":
      return isInt(o.submissionId) && isStr(o.date) && isInt(o.fileCount) && Array.isArray(o.fileNames) && o.fileNames.every(isStr)
        ? { kind, submissionId: o.submissionId, date: o.date, fileCount: o.fileCount, fileNames: o.fileNames }
        : null;
  }
}

// Never throws: bad JSON, a wrong type or a missing field gives { kind: "unknown" }.
export function parseActivityDetails(kind: string, json: string): ActivityDetails {
  try {
    const o: unknown = JSON.parse(json);
    if (typeof o !== "object" || o === null || Array.isArray(o)) return { kind: "unknown" };
    return shape(kind as ActivityKind, o as Record<string, unknown>) ?? { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

// The JSON text to store. Throws if the details do not pass the parser, so a bug rolls back the caller's transaction instead of writing a line that cannot be shown.
export function buildActivityDetails(d: Exclude<ActivityDetails, { kind: "unknown" }>): string {
  const { kind, ...rest } = d;
  const json = JSON.stringify(rest);
  if (parseActivityDetails(kind, json).kind !== kind) throw new Error(`Invalid ${kind} activity details.`);
  return json;
}

const pad = (n: number) => String(n).padStart(2, "0");
// When a submission counts as happening (a backdated one must sort by its date in the history): now if its date is today (local time),
// otherwise the last millisecond of that day, so it follows the files uploaded that day. `date` must be a real YYYY-MM-DD date.
export function submissionOccurredAt(date: string, now: Date): Date {
  if (date === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`) return now;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
