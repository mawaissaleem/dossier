// Server-only. "Back up and update": the in-app way to bring an existing database up to this version's migrations.
//  1. copy the database (SQLite's online backup, copyDatabaseTo) to a safety backup  2. apply the pending migrations  3. check none are left.
// Nothing is migrated unless step 1 worked. Step 2 is all-or-nothing (applyMigrations: one transaction), so on failure the data is as it was.
// Where the copy goes: the saved backup folder if it passes the same checks as "Back up now" and can be written, else backups/ next to
// the database file. What this relies on while updates are pending: pages and API routes are refused (DatabaseGate, databaseUpdateResponse);
// a server action from a stale tab is not gated, but it either fails on a missing table or column or writes the old schema, which the
// migration then carries over; migrate runs synchronously, so no request interleaves with it. Only one update runs at a time, per process.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { copyDatabaseTo, getBackupDestination } from "../db/backup";
import { getDb } from "../db/client";
import { applyMigrations, pendingMigrations } from "../db/migrations";
import { validateBackupDestination } from "./backup";

export type UpdateResult = { ok: true; backupPath: string | null } | { ok: false; error: string };

export const UPDATED_COOKIE = "dossier_updated"; // the safety backup path, shown once after the update (app/updated-note.tsx)

const g = globalThis as { __dossierUpdating?: boolean }; // route and action bundles can hold separate module copies

// Folders to try, in order. An old database may not have the settings table yet: then there is no saved folder.
async function candidateFolders(): Promise<string[]> {
  const out: string[] = [];
  try {
    const saved = await getBackupDestination();
    const v = saved && (await validateBackupDestination(saved));
    if (v && v.ok) out.push(v.path);
  } catch {}
  out.push(join(dirname(resolve(/*turbopackIgnore: true*/ getDb().$client.name)), "backups"));
  return out;
}

// The folder the update will try first, for the page text.
export const plannedBackupFolder = async () => (await candidateFolders())[0];

export const safetyBackupName = (now: Date, n = 1) =>
  `dossier-before-update-${now.toISOString().slice(0, 19).replace(/:/g, "-")}${n > 1 ? `-${n}` : ""}.db`;

export async function updateDatabase(opts: { migrationsFolder?: string; now?: Date } = {}): Promise<UpdateResult> {
  if (g.__dossierUpdating) return { ok: false, error: "An update is already running. Wait a moment, then reload." };
  g.__dossierUpdating = true;
  try {
    if (pendingMigrations() === 0) return { ok: true, backupPath: null };

    let backupPath: string | undefined;
    let lastError = "no folder to save it in";
    for (const dir of await candidateFolders()) {
      let path = join(dir, safetyBackupName(opts.now ?? new Date()));
      for (let n = 2; existsSync(path); n++) path = join(dir, safetyBackupName(opts.now ?? new Date(), n)); // never overwrite an earlier safety backup
      try {
        mkdirSync(dir, { recursive: true });
        await copyDatabaseTo(path);
        backupPath = path;
        break;
      } catch (e) {
        try { rmSync(path, { force: true }); } catch {} // a partial copy, if any
        lastError = (e as Error).message;
      }
    }
    if (!backupPath) return { ok: false, error: `Dossier could not save a backup copy of your database (${lastError}), so it did not update it. Your data was not changed.` };

    try {
      applyMigrations(opts.migrationsFolder);
    } catch (e) {
      return { ok: false, error: `The update failed (${(e as Error).message}). Your data was not changed. A backup copy is at ${backupPath}.` };
    }
    if (pendingMigrations() !== 0) return { ok: false, error: `The update ran but updates are still pending. Your backup copy is at ${backupPath}.` };
    return { ok: true, backupPath };
  } finally {
    g.__dossierUpdating = false;
  }
}
