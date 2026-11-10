// Server-only. The database side of a backup: a consistent copy of the live file, the schema version for the manifest, and the
// last-backup time (settings) that 8.3's reminder reads.
import { getDb } from "./client";
import { getSetting, setSetting } from "./settings";

export const LAST_BACKUP_KEY = "last_backup_at";

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
