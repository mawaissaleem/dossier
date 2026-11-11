"use server";

import { refresh, revalidatePath } from "next/cache";
import { getBackupDestination, setBackupDestination, setReminderDays } from "@/lib/db/backup";
import { currentCounts } from "@/lib/db/restore";
import { createBackup, validateBackupDestination, type BackupResult } from "@/lib/files/backup";
import { checkBackup as checkBackupZip, restoreFromBackup, type CheckResult, type RestoreResult } from "@/lib/files/restore";
import { lockedBy, MOVING_MESSAGE, tryLock } from "@/lib/files/lock";
import type { Counts } from "@/lib/restore";

// Validate (the same checks as the backup itself), then save; nothing is saved on error. Runs on any POST, so it takes unknown.
export async function saveBackupDestination(input: unknown): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const r = await validateBackupDestination(input);
  if (!r.ok) return r;
  try {
    await setBackupDestination(r.path);
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
  refresh();
  return r;
}

// FR-13.4: the reminder interval. Runs on any POST, so it takes unknown. refresh() updates the banner.
export async function saveReminderDays(input: unknown): Promise<{ ok: true; days: number } | { ok: false; error: string }> {
  try {
    const r = await setReminderDays(input);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// One backup, restore or files-root change at a time (a double click, a second tab): the shared lock in lib/files/lock.ts.

// "Back up now" (FR-12.1): backs up to the saved destination. refresh() re-renders the "Last backup" line.
export async function backUpNow(): Promise<BackupResult> {
  const lock = tryLock("backup");
  if (!lock.ok) return lock;
  try {
    const destination = await getBackupDestination();
    if (!destination) return { ok: false, error: "Choose and save a backup folder first." };
    const r = await createBackup(destination);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "The backup failed. Try again." };
  } finally {
    lock.release();
  }
}

// FR-12.3, step 1: read and validate a backup zip and say what it holds. Changes nothing. Refused while a backup or restore runs (a restore
// closes the database mid-way).
export async function checkBackup(input: unknown): Promise<CheckResult> {
  const busy = lockedBy();
  if (busy) return { ok: false, error: busy === "move" ? MOVING_MESSAGE : "A backup or restore is running. Try again when it is done." };
  try {
    return await checkBackupZip(input);
  } catch {
    return { ok: false, error: "The check failed. Try again." };
  }
}

// The confirm dialog's impact: what is in Dossier now (counted fresh on every open, DESIGN.md) and where the safety backup will go.
export async function fetchRestoreImpact(): Promise<{ ok: true; counts: Counts; destination: string | null } | { ok: false; error: string }> {
  try {
    return { ok: true, counts: currentCounts(), destination: await getBackupDestination() };
  } catch {
    return { ok: false, error: "Could not count your data. Try again." };
  }
}

// FR-12.3, step 2, after the confirmation. `expected` = the backup's date and the current counts the dialog showed; the restore refuses
// if either changed. Every page is revalidated (the whole database changed), and the banner with it.
export async function restoreBackup(input: unknown, expected: unknown): Promise<RestoreResult> {
  const lock = tryLock("restore");
  if (!lock.ok) return lock;
  try {
    const r = await restoreFromBackup(input, expected);
    if (r.ok) revalidatePath("/", "layout");
    return r;
  } catch {
    return { ok: false, error: "The restore failed. Try again." };
  } finally {
    lock.release();
  }
}
