// Pure helpers for the dashboard cards (no DB or UI imports).
import { dayNumber, deadlineInfo } from "./deadline";

// The first `n` items and how many were left out, for "N more in Planner".
export function firstN<T>(items: readonly T[], n: number): { shown: T[]; more: number } {
  return { shown: items.slice(0, n), more: Math.max(0, items.length - n) };
}

export type DeadlineInput = { id: number; title: string; trackId: number; trackName: string; deadline: unknown };
// `big`/`unit` are the display halves ("3" + "days", or "Today" + null); `text` reads as one phrase ("3 days").
export type UpcomingDeadline = Omit<DeadlineInput, "deadline"> & { date: string; days: number; big: string; unit: string | null; text: string };

// FR-9.3: items due today or later, nearest first (ties: lower id), at most `limit`. Overdue, blank and invalid deadlines are left out.
// 1 day is "Tomorrow", so the unit is only ever plural.
export function upcomingDeadlines(items: readonly DeadlineInput[], today: string, limit: number): UpcomingDeadline[] {
  const t = dayNumber(today);
  if (t === null) throw new Error(`today must be a YYYY-MM-DD day, got ${String(today)}`);
  const out: UpcomingDeadline[] = [];
  for (const { deadline, ...who } of items) {
    const n = dayNumber(deadline);
    if (n === null || n < t) continue;
    const days = n - t;
    const big = days === 0 ? "Today" : days === 1 ? "Tomorrow" : String(days);
    const unit = days > 1 ? "days" : null;
    out.push({ ...who, date: deadlineInfo(deadline, today)!.date, days, big, unit, text: unit ? `${big} ${unit}` : big });
  }
  return out.sort((a, b) => a.days - b.days || a.id - b.id).slice(0, Math.max(0, limit));
}

// "Overdue by 1 day" / "Overdue by 12 days".
export const overdueText = (days: number) => `Overdue by ${days} ${days === 1 ? "day" : "days"}`;

export type OverdueAlert = Omit<DeadlineInput, "deadline"> & { date: string; days: number; text: string };

// FR-9.5: items whose deadline is before today, most overdue first (ties: lower id). Due today, future, blank and invalid deadlines are left out.
export function overdueAlerts(items: readonly DeadlineInput[], today: string): OverdueAlert[] {
  const t = dayNumber(today);
  if (t === null) throw new Error(`today must be a YYYY-MM-DD day, got ${String(today)}`);
  const out: OverdueAlert[] = [];
  for (const { deadline, ...who } of items) {
    const n = dayNumber(deadline);
    if (n === null || n >= t) continue;
    const days = t - n;
    out.push({ ...who, date: deadlineInfo(deadline, today)!.date, days, text: overdueText(days) });
  }
  return out.sort((a, b) => b.days - a.days || a.id - b.id);
}

// ---- 11.5: weekly progress (FR-9.4). Weeks are Monday to Sunday calendar days (ISO), never instants. ----
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayString = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

// The Monday of the week containing `day` (1970-01-01 was a Thursday, so +3 counts days since Monday).
export function weekStart(day: string): string {
  const n = dayNumber(day);
  if (n === null) throw new Error(`day must be a YYYY-MM-DD day, got ${String(day)}`);
  return dayString(n - (((n + 3) % 7) + 7) % 7); // double % so days before 1970 work
}

// Monday, Sunday and a label for the week containing `today`: "10–16 Nov", "30 Nov – 6 Dec", "29 Dec 2026 – 4 Jan 2027" (year only when the week spans two).
export function weekRange(today: string): { start: string; end: string; label: string } {
  const start = weekStart(today);
  const end = dayString(dayNumber(start)! + 6);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const label = sy !== ey ? `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`
    : sm !== em ? `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}` : `${sd}–${ed} ${MONTHS[em - 1]}`;
  return { start, end, label };
}

// How many applications' first-submission dates (one per application) fall in the week starting `monday`. Invalid dates are not counted.
export function countInWeek(firstDates: readonly string[], monday: string): number {
  const s = dayNumber(monday);
  if (s === null) throw new Error(`monday must be a YYYY-MM-DD day, got ${String(monday)}`);
  return firstDates.filter((d) => { const n = dayNumber(d); return n !== null && n >= s && n <= s + 6; }).length;
}

export type WeeklyProgress = { count: number; capacity: number; ratio: number; met: boolean; start: string; end: string; label: string };

// `ratio` is capped at 1 for the ring ("5 of 4" is a full ring); `count` is not capped. Future-dated submissions count when still inside this week.
export function weeklyProgress(firstDates: readonly string[], capacity: number, today: string): WeeklyProgress {
  const range = weekRange(today);
  const count = countInWeek(firstDates, range.start);
  return { count, capacity, ratio: capacity > 0 ? Math.min(1, count / capacity) : 1, met: count >= capacity, ...range };
}

// ---- 11.6: streak (FR-9.4). ----
// Consecutive weeks ending with last week whose count (first-submission dates) is at least `capacity`, plus this week when it already meets it;
// this week not yet met does not break it, any earlier week below capacity ends it. Past weeks use the capacity given (history is not stored).
// Look-back is capped at `maxWeeks` past weeks. Dates after this week and invalid dates are ignored. One pass to bucket by week, then a walk back.
export function streak(firstDates: readonly string[], capacity: number, today: string, maxWeeks = 520): { weeks: number; thisWeekMet: boolean } {
  const t = dayNumber(today);
  if (t === null) throw new Error(`today must be a YYYY-MM-DD day, got ${String(today)}`);
  const weekOf = (n: number) => Math.floor((n + 3) / 7); // Monday-based week number (1970-01-05 starts week 1)
  const counts = new Map<number, number>();
  for (const d of firstDates) {
    const n = dayNumber(d);
    if (n !== null) counts.set(weekOf(n), (counts.get(weekOf(n)) ?? 0) + 1);
  }
  const now = weekOf(t);
  const thisWeekMet = (counts.get(now) ?? 0) >= capacity;
  let weeks = thisWeekMet ? 1 : 0;
  for (let w = now - 1; w >= now - maxWeeks && (counts.get(w) ?? 0) >= capacity; w--) weeks++;
  return { weeks, thisWeekMet };
}

// ---- 11.7: the one-sentence summary under the header, from the numbers the cards already show. ----
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Thursday 12 November · 2 overdue · next deadline in 3 days · 1 of 4 this week". Overdue only when there is any; the deadline part only with an upcoming one.
export function summaryLine(today: string, s: { overdue: number; nextDays: number | null; count: number; capacity: number }): string {
  const n = dayNumber(today);
  if (n === null) throw new Error(`today must be a YYYY-MM-DD day, got ${String(today)}`);
  const [, m, d] = today.split("-").map(Number);
  const parts = [`${WEEKDAYS[(((n + 3) % 7) + 7) % 7]} ${d} ${MONTHS_LONG[m - 1]}`];
  if (s.overdue > 0) parts.push(`${s.overdue} overdue`);
  if (s.nextDays !== null) parts.push(`next deadline ${s.nextDays === 0 ? "today" : s.nextDays === 1 ? "tomorrow" : `in ${s.nextDays} days`}`);
  parts.push(`${s.count} of ${s.capacity} this week`);
  return parts.join(" · ");
}
