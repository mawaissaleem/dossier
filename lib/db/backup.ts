// Server-only. The database side of a backup: a consistent copy of the live file, the schema version for the manifest, and the
// last-backup time (settings) that 8.3's reminder reads.
import { count, eq } from "drizzle-orm";
import { backupReminder, parseReminderDays, reminderDaysOrDefault, type BackupReminder } from "../backup-reminder";
import { getDb } from "./client";
import { applications } from "./schema";
import { getSetting, setSetting } from "./settings";
import { getUserId } from "./user";

export const LAST_BACKUP_KEY = "last_backup_at";
export const BACKUP_DESTINATION_KEY = "backup_destination";
export const REMINDER_DAYS_KEY = "backup_reminder_days";

// SQLite's online backup API: a consistent snapshot while the app keeps running, not a raw copy of the live file.
export async function copyDatabaseTo(file: string): Promise<void> {
  await getDb().$client.backup(file);
}

// Drizzle keeps one row per applied migration in __drizzle_migrations (created_at = the migration's journal timestamp).
export function getSchemaVersion(): { migrations: number; latest: number | null } {
  const row = getDb().$client.prepare("SELECT count(*) AS n, max(created_at) AS latest FROM __drizzle_migrations").get() as { n: number; latest: number | null };
  return { migrations: row.n, latest: row.latest };
}

export async function getLastBackupAt(): Promise<string | null> {
  const v = await getSetting(LAST_BACKUP_KEY);
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

export const recordBackup = (at: Date) => setSetting(LAST_BACKUP_KEY, at.toISOString());

export async function getBackupDestination(): Promise<string | null> {
  const v = await getSetting(BACKUP_DESTINATION_KEY);
  return typeof v === "string" && v !== "" ? v : null;
}

export const setBackupDestination = (path: string) => setSetting(BACKUP_DESTINATION_KEY, path);

// Days before the reminder shows: the saved value, or the default when unset or not valid.
export async function getReminderDays(): Promise<number> {
  return reminderDaysOrDefault(await getSetting(REMINDER_DAYS_KEY));
}

// Validates (the action passes unknown input); nothing is saved on error.
export async function setReminderDays(input: unknown): Promise<{ ok: true; days: number } | { ok: false; error: string }> {
  const r = parseReminderDays(input);
  if (r.ok) await setSetting(REMINDER_DAYS_KEY, r.days);
  return r;
}

// What the app-wide banner shows now (null = nothing). "Has applications" counts archived ones too: they are still data.
export async function getBackupReminder(now = new Date()): Promise<BackupReminder | null> {
  const [lastBackupAt, intervalDays] = await Promise.all([getLastBackupAt(), getReminderDays()]);
  const n = getDb().select({ n: count() }).from(applications).where(eq(applications.userId, getUserId())).get()?.n ?? 0;
  return backupReminder({ lastBackupAt, intervalDays, now, hasApplications: n > 0 });
}
