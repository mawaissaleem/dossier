// Pure deadline text for the board card (no DB, React or timezone use). Dates are "YYYY-MM-DD" calendar days, never instants: day
// arithmetic goes through Date.UTC only to count days between two calendar dates, so the result cannot drift with the zone or DST.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Whole days since 1970-01-01 of a valid YYYY-MM-DD, or null (wrong shape, or a day that does not exist such as 2026-02-30).
function dayNumber(s: unknown): number | null {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.getTime() / 86_400_000 : null;
}

// The browser's local calendar day as YYYY-MM-DD.
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export type Deadline = { date: string; relative: string | null; overdue: boolean };

// "12 Nov 2026" plus a hint relative to `today` ("today", "tomorrow", "in 3 days", "yesterday", "2 days ago"). Overdue = the date is before
// today, whatever the application's status. null for a blank or invalid value, so the card leaves the line out.
// `today` null (server render, where the visitor's day is unknown) gives the date only, with no hint and no overdue flag.
export function deadlineInfo(value: unknown, today: string | null): Deadline | null {
  const n = dayNumber(value);
  if (n === null) return null;
  const [y, m, d] = (value as string).split("-").map(Number);
  const date = `${d} ${MONTHS[m - 1]} ${y}`;
  const t = today === null ? null : dayNumber(today);
  if (t === null) return { date, relative: null, overdue: false };
  const diff = n - t;
  const relative = diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday" : diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
  return { date, relative, overdue: diff < 0 };
}
