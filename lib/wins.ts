// Pure: wins (FR-9.7), no DB or UI imports. A win is an application whose current status is one of the track's "win"
// statuses (Interview, Offer by default).
import { deadlineInfo, localToday } from "./deadline";

type Opt = { id: number; label: string };
const DEFAULT_LABELS = ["interview", "offer"];

// `stored` is the parsed setting (undefined = never saved, or not a list = unreadable, both fall back to the labels
// Interview / Offer, case-insensitive). A saved list keeps only ids that are still options of the status column, in
// option order; an empty list stays empty (same rule as submitted statuses).
export function resolveWinStatuses(stored: unknown, options: Opt[]): number[] {
  const keep = Array.isArray(stored)
    ? (o: Opt) => stored.includes(o.id)
    : (o: Opt) => DEFAULT_LABELS.includes(o.label.trim().toLowerCase());
  return options.filter(keep).map((o) => o.id);
}

export type Win = {
  id: number;
  title: string;
  trackId: number;
  trackName: string;
  label: string;
  color: string;
  archived: boolean;
  since: number;
};

// Most recently reached first (`since` = ms since epoch); ties: lower id. Returns a new array.
export const orderWins = <T extends { id: number; since: number }>(wins: readonly T[]): T[] =>
  [...wins].sort((a, b) => b.since - a.since || a.id - b.id);

const plural = (n: number, label: string) => {
  const w = label.trim().toLowerCase();
  // shortcut: plain "s" rule, irregular plurals are not handled, a label can be edited to read right
  return n === 1 || w.endsWith("s") ? w : `${w}s`;
};

// "2 interviews · 1 offer". Statuses with the same label (Job's and PhD's Interview) are one entry; entries keep the
// order of `labels` (the configured order); zero counts are left out.
export function winCountsText(wins: readonly { label: string }[], labels: readonly string[]): string {
  const key = (l: string) => l.trim().toLowerCase();
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const l of labels) {
    if (seen.has(key(l))) continue;
    seen.add(key(l));
    const n = wins.filter((w) => key(w.label) === key(l)).length;
    if (n > 0) parts.push(`${n} ${plural(n, l)}`);
  }
  return parts.join(" · ");
}

// "No interviews or offers yet" / "No interviews, offers or hires yet" from the configured labels (distinct, in order).
export function noWinsText(labels: readonly string[]): string {
  const seen = new Set<string>();
  const words = labels
    .filter((l) => !seen.has(l.trim().toLowerCase()) && seen.add(l.trim().toLowerCase()))
    .map((l) => plural(2, l));
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : (words[0] ?? "wins");
  return `No ${list} yet`;
}

// "3 days ago" / "today" / "yesterday" for the local day of `since`; null if either day is unreadable. A future `since`
// (clock change) reads "in 2 days".
export function winAge(since: number, today: string): { text: string; date: string } | null {
  const day = localToday(new Date(since));
  const d = deadlineInfo(day, today);
  return d?.relative ? { text: d.relative, date: d.date } : null;
}
