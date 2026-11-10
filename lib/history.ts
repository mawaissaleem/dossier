// Pure (no DB, no UI). Merges an application's notes and automatic log events into one history (FR-11.3). Each line is built from the
// event's stored snapshot only, so nothing is looked up and a renamed status or file never rewrites the past.
import type { ActivityDetails } from "./activity";

export type HistoryType = "note" | "status" | "upload" | "submission" | "other";
// `text` is the note body (type "note") or the one-line summary of an event. `future` marks an event dated after `now` (a scheduled submission).
export type HistoryItem = { key: string; type: HistoryType; at: Date; text: string; future: boolean };

type NoteIn = { id: number; body: string; createdAt: Date };
type EventIn = { id: number; kind: string; occurredAt: Date; details: ActivityDetails };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-10" -> "10 Nov 2026" (fixed English, no locale or zone, so the line is the same everywhere); anything else is shown as stored.
export function formatYmd(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : s;
}

const TYPE: Record<string, HistoryType> = { status_changed: "status", file_uploaded: "upload", submission_created: "submission" };
const FALLBACK: Record<HistoryType, string> = { note: "Note", status: "Status changed", upload: "File uploaded", submission: "Submission recorded", other: "Activity recorded" };

// Garbled or unknown details give a neutral line for the kind; never throws.
export function eventLine(kind: string, d: ActivityDetails): string {
  switch (d.kind) {
    case "status_changed":
      return `Status: ${d.fromLabel || "(blank)"} → ${d.toLabel || "(blank)"}`;
    case "file_uploaded":
      return `Uploaded ${d.originalName} as ${d.storedName} (${d.label})`;
    case "submission_created":
      return `Submission dated ${formatYmd(d.date)} with ${d.fileCount === 0 ? "no files" : d.fileCount === 1 ? "1 file" : `${d.fileCount} files`}`;
    default:
      return FALLBACK[TYPE[kind] ?? "other"];
  }
}

// Newest first by when it happened (note created_at, event occurred_at). Equal instants: notes before events, then the higher id first
// (the later write), so the order never depends on the input order.
export function buildHistory(notes: NoteIn[], events: EventIn[], now: Date): HistoryItem[] {
  const all = [
    ...notes.map((n) => ({ rank: 1, id: n.id, item: { key: `note-${n.id}`, type: "note", at: n.createdAt, text: n.body, future: false } as HistoryItem })),
    ...events.map((e) => {
      const type = TYPE[e.kind] ?? "other";
      return { rank: 0, id: e.id, item: { key: `event-${e.id}`, type, at: e.occurredAt, text: eventLine(e.kind, e.details), future: e.occurredAt > now } as HistoryItem };
    }),
  ];
  return all.sort((a, b) => b.item.at.getTime() - a.item.at.getTime() || b.rank - a.rank || b.id - a.id).map((x) => x.item);
}
