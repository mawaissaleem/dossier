// Pure rules for the backup zip (no fs, no DB): its file name and its manifest. Task 8.4 (restore) reads the zip with parseManifest.
//
// Zip layout, format version 1:
//   manifest.json          JSON, see BackupManifest
//   database/dossier.db    a consistent SQLite copy (online backup), a complete database on its own
//   files/<relative path>  every regular file under the files root, same relative path (forward slashes) as stored in the database;
//                          symlinks are not followed and not included; empty folders are omitted; absent when no files root was set
//                          regular file entries only (restore should still reject any other entry type); entries keep the
//                          source mode, so stored files arrive as 0444 and restore must set permissions itself
export const BACKUP_FORMAT = "dossier-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_NAME = "manifest.json";
export const DB_ENTRY = "database/dossier.db";
export const FILES_PREFIX = "files/";

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string; // ISO 8601, UTC
  schema: { migrations: number; latest: number | null }; // applied drizzle migrations: how many, and the newest one's timestamp
  databaseEntry: string;
  filesRoot: string | null; // the files root path when the backup was made; null = none was configured (database only)
  fileCount: number; // files under files/ in the zip
  filesBytes: number; // their total size (the database copy is not counted)
};

export function buildManifest(input: Omit<BackupManifest, "format" | "formatVersion" | "databaseEntry">): BackupManifest {
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, databaseEntry: DB_ENTRY, ...input };
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export type ManifestResult = { ok: true; manifest: BackupManifest } | { ok: false; error: string };

export function parseManifest(input: unknown): ManifestResult {
  const bad = (error: string): ManifestResult => ({ ok: false, error });
  if (typeof input !== "object" || input === null) return bad("The backup manifest is not an object.");
  const m = input as Record<string, unknown>;
  if (m.format !== BACKUP_FORMAT) return bad("This is not a Dossier backup.");
  if (m.formatVersion !== BACKUP_FORMAT_VERSION) return bad("This backup was made by a different version of Dossier and cannot be read.");
  if (typeof m.createdAt !== "string" || Number.isNaN(Date.parse(m.createdAt))) return bad("The backup manifest has no valid date.");
  const s = m.schema as Record<string, unknown> | null;
  if (typeof s !== "object" || s === null || !isCount(s.migrations) || !(s.latest === null || isCount(s.latest))) return bad("The backup manifest has no valid schema version.");
  if (m.databaseEntry !== DB_ENTRY) return bad("The backup manifest names an unknown database entry.");
  if (!(m.filesRoot === null || typeof m.filesRoot === "string") || !isCount(m.fileCount) || !isCount(m.filesBytes)) return bad("The backup manifest is incomplete.");
  return { ok: true, manifest: m as BackupManifest };
}

const pad = (n: number) => String(n).padStart(2, "0");

// dossier-backup-20261110-1432.zip (local time); attempt 2 adds "-2" so two backups in one minute never share a name.
export function backupFileName(when: Date, attempt = 1): string {
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `dossier-backup-${stamp}${attempt > 1 ? `-${attempt}` : ""}.zip`;
}
