// Server-only. The database side of a restore (task 8.4). Nothing here touches the live database until swapDatabase, and that is a few
// synchronous renames, so no request can run between them.
//  - stagedDatabasePath: where the backup's database copy is unpacked, next to the live file (same file system, so the final move is a rename)
//  - inspectBackupDb: opens the unpacked copy read-only and judges it (integrity, tables, schema version, counts, its file rows)
//  - finalizeStagedDb: on the copy only: run pending migrations (older backup), put this computer's own settings back, re-check
//  - swapDatabase: closeDb(), the live file (and a stale -wal/-shm) moves aside, the copy takes its place; undo() puts everything back
// The migrations folder is the app's own ./drizzle (the same one scripts/migrate.ts and the tests use), not user data.
import { randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { checkRelativePath } from "../files/relative";
import { COUNT_KEYS, KEPT_SETTING_KEYS, schemaIsNewer, STAGE_PREFIX, type Counts } from "../restore";
import { closeDb, getDb } from "./client";
import { settings } from "./schema";
import { getUserId } from "./user";

const MIGRATIONS = "./drizzle";
// Tables the first migration creates: a copy without them is not a Dossier database. Later tables arrive with the migrations.
const CORE_TABLES = ["__drizzle_migrations", "tracks", "columns", "column_options", "applications", "cell_values", "settings"];
const TABLE_FOR: Record<keyof Counts, string> = { applications: "applications", columns: "columns", files: "files", submissions: "submissions", notes: "notes" };

const livePath = () => resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? "");
export const stagedDatabasePath = () => join(dirname(livePath()), `${STAGE_PREFIX}${randomBytes(6).toString("hex")}.db`);

// Files that still have bytes (8.8: a deleted file keeps only a row). A backup made before the deleted_at column has none of those.
function liveFiles(sqlite: Database.Database): string {
  return (sqlite.pragma("table_info(files)") as { name: string }[]).some((c) => c.name === "deleted_at") ? "files WHERE deleted_at IS NULL" : "files";
}

// All rows: this is a single-user database and the question is "what would be replaced". Files counts live files only, so it matches the zip.
function countsOf(sqlite: Database.Database): Counts {
  const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  const out = {} as Counts;
  for (const k of COUNT_KEYS) out[k] = tables.has(TABLE_FOR[k]) ? (sqlite.prepare(`SELECT count(*) AS n FROM ${k === "files" ? liveFiles(sqlite) : TABLE_FOR[k]}`).get() as { n: number }).n : 0;
  return out;
}

export const currentCounts = (): Counts => countsOf(getDb().$client);

// The newest migration this app knows (its journal), to tell a newer backup from an older one.
let latestMemo: number | null | undefined;
function appLatestMigration(): number | null {
  if (latestMemo !== undefined) return latestMemo;
  const sqlite = new Database(":memory:");
  try {
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
    return (latestMemo = (sqlite.prepare("SELECT max(created_at) AS latest FROM __drizzle_migrations").get() as { latest: number | null }).latest);
  } finally {
    sqlite.close();
  }
}

export type BackupDbInfo = { counts: Counts; filePaths: { relativePath: string; sha256: string }[]; schemaOlder: boolean };

function integrityProblem(sqlite: Database.Database): string | null {
  const rows = sqlite.pragma("integrity_check") as { integrity_check: string }[];
  if (rows.length !== 1 || rows[0].integrity_check !== "ok") return "The database inside the backup is damaged (SQLite's integrity check failed).";
  if ((sqlite.pragma("foreign_key_check") as unknown[]).length > 0) return "The database inside the backup has broken links between its records.";
  return null;
}

export function inspectBackupDb(file: string): { ok: true; info: BackupDbInfo } | { ok: false; error: string } {
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true });
    const problem = integrityProblem(sqlite);
    if (problem) return { ok: false, error: problem };
    const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    if (!CORE_TABLES.every((t) => tables.has(t))) return { ok: false, error: "The database inside the backup is not a Dossier database (tables are missing)." };
    const latest = (sqlite.prepare("SELECT max(created_at) AS latest FROM __drizzle_migrations").get() as { latest: number | null }).latest;
    const appLatest = appLatestMigration();
    if (schemaIsNewer(latest, appLatest)) return { ok: false, error: "This backup was made by a newer version of Dossier than this one. Update Dossier, then restore it." };
    const rows = tables.has("files") ? (sqlite.prepare(`SELECT relative_path, sha256 FROM ${liveFiles(sqlite)}`).all() as { relative_path: string; sha256: string }[]) : [];
    for (const r of rows) {
      const c = checkRelativePath(r.relative_path);
      if (!c.ok) return { ok: false, error: `The backup's database has a file with an unsafe path (${JSON.stringify(r.relative_path.slice(0, 80))}): ${c.error}` };
    }
    return { ok: true, info: { counts: countsOf(sqlite), filePaths: rows.map((r) => ({ relativePath: r.relative_path, sha256: r.sha256 })), schemaOlder: latest !== appLatest } };
  } catch {
    return { ok: false, error: "The database inside the backup cannot be opened. The backup is damaged." };
  } finally {
    sqlite?.close();
  }
}

// Reads this computer's own settings from the live database (call it after the safety backup, which updates last_backup_at).
const keptRows = () => getDb().select().from(settings).where(and(eq(settings.userId, getUserId()), inArray(settings.key, [...KEPT_SETTING_KEYS]))).all();

// On the staged copy only: migrate, put the kept settings back (a key unset here is removed from the copy), check again.
export function finalizeStagedDb(file: string): void {
  const sqlite = new Database(file);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: MIGRATIONS });
    db.delete(settings).where(and(eq(settings.userId, getUserId()), inArray(settings.key, [...KEPT_SETTING_KEYS]))).run();
    const kept = keptRows();
    if (kept.length) db.insert(settings).values(kept.map((r) => ({ userId: r.userId, key: r.key, value: r.value, createdAt: r.createdAt, updatedAt: r.updatedAt }))).run();
    const problem = integrityProblem(sqlite);
    if (problem) throw new Error(problem);
  } finally {
    sqlite.close();
  }
}

export type DbSwap = { undo(): void; discard(): void };

// Synchronous on purpose (see the header). Throws, after putting everything back, if a step fails.
export function swapDatabase(staged: string): DbSwap {
  const live = livePath();
  const aside = `${live}.restore-old-${randomBytes(6).toString("hex")}`;
  const moved: string[] = []; // suffixes that went aside
  closeDb();
  const undo = () => {
    closeDb();
    rmSync(live, { force: true }); // the restored copy (or nothing)
    for (const s of ["-wal", "-shm"]) rmSync(live + s, { force: true });
    for (const s of moved) renameSync(aside + s, live + s);
  };
  try {
    for (const s of ["", "-wal", "-shm"]) {
      if (existsSync(live + s)) {
        renameSync(live + s, aside + s);
        moved.push(s);
      }
    }
    renameSync(staged, live);
  } catch (e) {
    undo();
    throw e;
  }
  return { undo, discard: () => { for (const s of moved) rmSync(aside + s, { force: true }); } };
}

export const removeStaged = (file: string) => rmSync(file, { force: true });
