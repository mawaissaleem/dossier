// Pure: everything a track card (dashboard) and a track tile (/tracks) show, shaped from rows the loader (lib/db/track-overview.ts) already read. No DB or UI imports.
import { dayNumber } from "./deadline";
import type { TrackPipeline } from "./pipeline";

export const ATTENTION_DAYS = 14; // still-to-do applications whose deadline is this close (or past) need attention
export const STALE_DAYS = 21; // submitted, not a win, and untouched this long needs attention
export const ACTIVE_DAYS = 30; // "Most active" counts the applications touched this recently

const DAY = 86_400_000;

// `touchedMs` = last touched (the planner's meaning: the application's own update or its newest note or event). `deadline` only matters for still-to-do applications.
export type OverviewApp = {
  id: number;
  title: string;
  statusId: number | null;
  touchedMs: number;
  deadline: string | null;
};
export type OverviewInput = {
  pipeline: TrackPipeline;
  todoIds: number[];
  submittedIds: number[];
  winIds: number[];
  apps: OverviewApp[];
};

// tone: "overdue" = destructive, "warning" = due today or tomorrow, "muted" = the rest. `kind` + `when` always say it in words ("Deadline · 2 days late").
export type AttentionItem = {
  id: number;
  title: string;
  kind: string;
  when: string;
  tone: "overdue" | "warning" | "muted";
};

export type TrackOverview = {
  id: number;
  name: string;
  color: string;
  pipeline: TrackPipeline;
  total: number;
  toApply: number;
  submitted: number;
  wins: number;
  updatedMs: number | null;
  updated: string | null;
  attention: AttentionItem[];
  overdue: number; // still-to-do applications whose deadline has passed (the destructive part of the attention line)
  nextDeadlineDays: number | null; // days to the nearest deadline of a still-to-do application that is not past (0 = today); null when there is none
  activeCount: number; // applications touched in the last ACTIVE_DAYS days (the "Most active" sort)
};

export const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

// "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", "2 weeks ago", "3 months ago". A time in the future (clock change) reads "just now".
export function relativeTime(thenMs: number, nowMs: number): string {
  const s = Math.max(0, nowMs - thenMs) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${plural(Math.floor(s / 60), "minute")} ago`;
  if (s < DAY / 1000) return `${plural(Math.floor(s / 3600), "hour")} ago`;
  const days = Math.floor(s / (DAY / 1000));
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${plural(Math.floor(days / 7), "week")} ago`;
  return `${plural(Math.floor(days / 30), "month")} ago`;
}

function deadlineWhen(days: number): Pick<AttentionItem, "when" | "tone"> {
  if (days < 0) return { when: `${plural(-days, "day")} late`, tone: "overdue" };
  if (days === 0) return { when: "Today", tone: "warning" };
  if (days === 1) return { when: "Tomorrow", tone: "warning" };
  return { when: `In ${days} days`, tone: "muted" };
}

// `today` is the visitor's local YYYY-MM-DD, `nowMs` the instant (both given, so a test never reads the clock).
export function trackOverview(input: OverviewInput, today: string, nowMs: number): TrackOverview {
  const { pipeline, apps } = input;
  const t = dayNumber(today);
  if (t === null) throw new Error(`today must be a YYYY-MM-DD day, got ${String(today)}`);
  const [todo, submitted, win] = [new Set(input.todoIds), new Set(input.submittedIds), new Set(input.winIds)];
  const inSet = (s: Set<number>, a: OverviewApp) => a.statusId !== null && s.has(a.statusId);

  const updatedMs = apps.reduce<number | null>((m, a) => (m === null || a.touchedMs > m ? a.touchedMs : m), null);

  const dated = apps.flatMap((a) => {
    const n = inSet(todo, a) ? dayNumber(a.deadline) : null;
    return n === null ? [] : [{ a, days: n - t }];
  });
  const due = dated.filter((d) => d.days <= ATTENTION_DAYS).sort((x, y) => x.days - y.days || x.a.id - y.a.id);
  const upcoming = dated.filter((d) => d.days >= 0).map((d) => d.days);
  const seen = new Set(due.map((d) => d.a.id));
  const stale = apps
    .flatMap((a) => {
      const days = Math.floor((nowMs - a.touchedMs) / DAY);
      return inSet(submitted, a) && !inSet(win, a) && days >= STALE_DAYS && !seen.has(a.id) ? [{ a, days }] : [];
    })
    .sort((x, y) => y.days - x.days || x.a.id - y.a.id);
  const attention: AttentionItem[] = [
    ...due.map(({ a, days }) => ({ id: a.id, title: a.title, kind: "Deadline", ...deadlineWhen(days) })),
    ...stale.map(({ a, days }) => ({
      id: a.id,
      title: a.title,
      kind: "No update since submitting",
      when: plural(days, "day"),
      tone: "overdue" as const,
    })),
  ];

  return {
    id: pipeline.id,
    name: pipeline.name,
    color: pipeline.color,
    pipeline,
    total: apps.length,
    toApply: apps.filter((a) => inSet(todo, a)).length,
    submitted: apps.filter((a) => inSet(submitted, a)).length,
    wins: apps.filter((a) => inSet(win, a)).length,
    updatedMs,
    updated: updatedMs === null ? null : relativeTime(updatedMs, nowMs),
    attention,
    overdue: due.filter((d) => d.days < 0).length,
    nextDeadlineDays: upcoming.length ? Math.min(...upcoming) : null,
    activeCount: apps.filter((a) => nowMs - a.touchedMs <= ACTIVE_DAYS * DAY).length,
  };
}

// The attention line of a track tile and the sentence under it. `alert` = the destructive part ("1 overdue"), `text` the muted rest; always words, colour only adds to it.
// "1 overdue · 2 more need attention" / "1 overdue · next deadline in 11 days" / "Next deadline in 6 days" / "Nothing needs attention" / "Add the first application to start this track".
export function attentionLine(o: Pick<TrackOverview, "total" | "attention" | "overdue" | "nextDeadlineDays">): {
  alert: string | null;
  text: string;
} {
  const alert = o.overdue > 0 ? `${o.overdue} overdue` : null;
  const rest = o.attention.length - o.overdue;
  const d = o.nextDeadlineDays;
  const next = d === null ? null : `next deadline ${d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`}`;
  const text =
    rest > 0
      ? `${rest}${alert ? " more" : ""} ${rest === 1 ? "needs" : "need"} attention`
      : (next ??
        (alert ? "" : o.total === 0 ? "Add the first application to start this track" : "Nothing needs attention"));
  return { alert, text: alert || !text ? text : text[0].toUpperCase() + text.slice(1) };
}

export const TRACK_SORTS = ["recent", "name", "active"] as const;
export type TrackSort = (typeof TRACK_SORTS)[number];
export const TRACK_SORT_LABELS: Record<TrackSort, string> = { recent: "Recent", name: "Name", active: "Most active" };
// ?sort= from the URL: anything unknown (or repeated) is the default.
export const parseTrackSort = (v: unknown): TrackSort =>
  (TRACK_SORTS as readonly unknown[]).includes(v) ? (v as TrackSort) : "recent";

// A new array. recent = last updated first, tracks with no applications last; name = A to Z ignoring case; active = most applications touched in the last 30 days first, then recent.
// Ties keep the incoming (position) order, so the result never jumps around.
export function sortTracks<T extends Pick<TrackOverview, "name" | "updatedMs" | "activeCount">>(
  os: readonly T[],
  sort: TrackSort,
): T[] {
  const recent = (a: T, b: T) => (b.updatedMs ?? -Infinity) - (a.updatedMs ?? -Infinity) || 0;
  const by = {
    recent,
    name: (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    active: (a: T, b: T) => b.activeCount - a.activeCount || recent(a, b),
  }[sort];
  return [...os].sort(by); // Array.prototype.sort is stable
}

// "2 tracks · 11 applications · 4 need attention" (the /tracks header).
export function overviewSummary(os: readonly Pick<TrackOverview, "total" | "attention">[]): string {
  const need = os.reduce((n, o) => n + o.attention.length, 0);
  return [
    plural(os.length, "track"),
    plural(
      os.reduce((n, o) => n + o.total, 0),
      "application",
    ),
    `${need} ${need === 1 ? "needs" : "need"} attention`,
  ].join(" · ");
}
