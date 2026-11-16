// Pure: everything a track card (dashboard) and a track panel (/tracks) show, shaped from rows the loader (lib/db/track-overview.ts) already read. No DB or UI imports.
import { dayNumber } from "./deadline";
import type { TrackPipeline } from "./pipeline";

export const ATTENTION_DAYS = 14; // still-to-do applications whose deadline is this close (or past) need attention
export const STALE_DAYS = 21; // submitted, not a win, and untouched this long needs attention
export const RECENT_COUNT = 3;

const DAY = 86_400_000;

// `touchedMs` = last touched (the planner's meaning: the application's own update or its newest note or event). `deadline` only matters for still-to-do applications.
export type OverviewApp = { id: number; title: string; statusId: number | null; touchedMs: number; deadline: string | null; firstSubmitted: string | null };
export type OverviewInput = { pipeline: TrackPipeline; todoIds: number[]; submittedIds: number[]; winIds: number[]; apps: OverviewApp[] };

export type RecentItem = { id: number; title: string; status: string | null; touchedMs: number; when: string }; // when = relativeTime at the request
// tone: "overdue" = destructive, "warning" = due today or tomorrow, "muted" = the rest. `kind` + `when` always say it in words ("Deadline · 2 days late").
export type AttentionItem = { id: number; title: string; kind: string; when: string; tone: "overdue" | "warning" | "muted" };

export type TrackOverview = {
  id: number; name: string; pipeline: TrackPipeline;
  total: number; toApply: number; submitted: number; wins: number;
  winRate: number | null; // whole percent of the applications that reached a submitted or win status; null when none did
  submittedThisMonth: number;
  ids: { todo: number[]; submitted: number[]; win: number[] }; // the status options behind each count, for the `?f=` links
  updatedMs: number | null; updated: string | null; recent: RecentItem[]; attention: AttentionItem[];
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

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
  const label = new Map(pipeline.segments.map((s) => [s.token, s.label]));
  const inSet = (s: Set<number>, a: OverviewApp) => a.statusId !== null && s.has(a.statusId);

  const wins = apps.filter((a) => inSet(win, a)).length;
  const reached = apps.filter((a) => inSet(submitted, a) || inSet(win, a)).length; // a win status usually comes after the submitted ones, so wins are not a share of "Applied" alone
  const month = today.slice(0, 7);
  const updatedMs = apps.reduce<number | null>((m, a) => (m === null || a.touchedMs > m ? a.touchedMs : m), null);

  const recent = [...apps].sort((a, b) => b.touchedMs - a.touchedMs || b.id - a.id).slice(0, RECENT_COUNT)
    .map((a) => ({ id: a.id, title: a.title, status: a.statusId === null ? null : label.get(a.statusId) ?? null, touchedMs: a.touchedMs, when: relativeTime(a.touchedMs, nowMs) }));

  const due = apps.flatMap((a) => {
    const n = inSet(todo, a) ? dayNumber(a.deadline) : null;
    return n !== null && n - t <= ATTENTION_DAYS ? [{ a, days: n - t }] : [];
  }).sort((x, y) => x.days - y.days || x.a.id - y.a.id);
  const seen = new Set(due.map((d) => d.a.id));
  const stale = apps.flatMap((a) => {
    const days = Math.floor((nowMs - a.touchedMs) / DAY);
    return inSet(submitted, a) && !inSet(win, a) && days >= STALE_DAYS && !seen.has(a.id) ? [{ a, days }] : [];
  }).sort((x, y) => y.days - x.days || x.a.id - y.a.id);
  const attention: AttentionItem[] = [
    ...due.map(({ a, days }) => ({ id: a.id, title: a.title, kind: "Deadline", ...deadlineWhen(days) })),
    ...stale.map(({ a, days }) => ({ id: a.id, title: a.title, kind: "No update since submitting", when: plural(days, "day"), tone: "overdue" as const })),
  ];

  return {
    id: pipeline.id, name: pipeline.name, pipeline,
    total: apps.length,
    toApply: apps.filter((a) => inSet(todo, a)).length,
    submitted: apps.filter((a) => inSet(submitted, a)).length,
    wins,
    winRate: reached ? Math.round((wins / reached) * 100) : null,
    submittedThisMonth: apps.filter((a) => a.firstSubmitted?.startsWith(month)).length,
    ids: { todo: input.todoIds, submitted: input.submittedIds, win: input.winIds },
    updatedMs, updated: updatedMs === null ? null : relativeTime(updatedMs, nowMs),
    recent, attention,
  };
}

// "2 tracks · 11 applications · 4 need attention" (the /tracks header).
export function overviewSummary(os: readonly Pick<TrackOverview, "total" | "attention">[]): string {
  const need = os.reduce((n, o) => n + o.attention.length, 0);
  return [plural(os.length, "track"), plural(os.reduce((n, o) => n + o.total, 0), "application"), `${need} ${need === 1 ? "needs" : "need"} attention`].join(" · ");
}
