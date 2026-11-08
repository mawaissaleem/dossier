// Pure: which status options count as "submitted" (FR-3.5), no DB or UI imports.
// Fallback when the setting was never saved: options labelled "Applied" (Job) or "Submitted" (PhD), matched case-insensitively on any track.
const DEFAULT_LABELS = ["applied", "submitted"];

type Opt = { id: number; label: string };

// `stored` is the parsed setting (undefined = never saved, or not a list = unreadable, both fall back to the defaults).
// A saved list keeps only ids that are still options of the status column, in option order; an empty list stays empty.
export function resolveSubmittedStatuses(stored: unknown, options: Opt[]): number[] {
  const keep = Array.isArray(stored)
    ? (o: Opt) => stored.includes(o.id)
    : (o: Opt) => DEFAULT_LABELS.includes(o.label.trim().toLowerCase());
  return options.filter(keep).map((o) => o.id);
}

// The ids to save, or an error. Every id must be an option of the track's status column.
export function checkSubmittedIds(ids: unknown, options: Opt[]): { ids: number[] } | { error: string } {
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) return { error: "Choose statuses from the list." };
  if (!ids.every((id) => options.some((o) => o.id === id))) return { error: "A chosen status is not a status of this track." };
  return { ids: options.filter((o) => ids.includes(o.id)).map((o) => o.id) };
}
