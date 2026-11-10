// Pure rules for the backup reminder (FR-12.2, FR-13.4): no DB, no clock of its own.
export const DEFAULT_REMINDER_DAYS = 7;
export const MIN_REMINDER_DAYS = 1;
export const MAX_REMINDER_DAYS = 365;
const DAY_MS = 86_400_000;

// A whole number of days, MIN..MAX. A number or a typed string of digits (the form sends text); anything else is refused.
export function parseReminderDays(input: unknown): { ok: true; days: number } | { ok: false; error: string } {
  const n = typeof input === "number" ? input : typeof input === "string" && /^\s*\d{1,4}\s*$/.test(input) ? Number(input) : NaN;
  if (!Number.isInteger(n) || n < MIN_REMINDER_DAYS || n > MAX_REMINDER_DAYS) {
    return { ok: false, error: `Enter a whole number of days from ${MIN_REMINDER_DAYS} to ${MAX_REMINDER_DAYS}.` };
  }
  return { ok: true, days: n };
}

// A stored value that is not valid falls back to the default rather than breaking every page.
export const reminderDaysOrDefault = (stored: unknown): number => {
  const r = parseReminderDays(stored);
  return r.ok ? r.days : DEFAULT_REMINDER_DAYS;
};

export type BackupReminder = { kind: "never" } | { kind: "overdue"; days: number };

// null = no reminder.
// - Backed up before: overdue only when the last backup is strictly older than `intervalDays` (exactly N days is not overdue).
//   A last backup in the future (the clock moved back) or a garbled time is not trusted as "recent": a future time counts as just made
//   (no reminder), a garbled one as never.
// - Never backed up: remind only once the app holds an application (`hasApplications`); a fresh empty install has nothing to lose, so no nagging.
export function backupReminder({ lastBackupAt, intervalDays, now, hasApplications }: {
  lastBackupAt: string | null; intervalDays: number; now: Date; hasApplications: boolean;
}): BackupReminder | null {
  const last = lastBackupAt === null ? NaN : Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return hasApplications ? { kind: "never" } : null;
  const age = now.getTime() - last;
  return age > intervalDays * DAY_MS ? { kind: "overdue", days: Math.floor(age / DAY_MS) } : null;
}

export function reminderMessage(r: BackupReminder): string {
  return r.kind === "never" ? "You have never backed up your data." : `Your last backup was ${r.days} ${r.days === 1 ? "day" : "days"} ago.`;
}
