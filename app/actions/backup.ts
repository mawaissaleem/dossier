"use server";

import { refresh } from "next/cache";
import { getBackupDestination, setBackupDestination } from "@/lib/db/backup";
import { createBackup, validateBackupDestination, type BackupResult } from "@/lib/files/backup";

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

let running = false; // one backup at a time (a double click, a second tab); shortcut: per server process, fine for one local user

// "Back up now" (FR-12.1): backs up to the saved destination. refresh() re-renders the "Last backup" line.
export async function backUpNow(): Promise<BackupResult> {
  if (running) return { ok: false, error: "A backup is already running." };
  running = true;
  try {
    const destination = await getBackupDestination();
    if (!destination) return { ok: false, error: "Choose and save a backup folder first." };
    const r = await createBackup(destination);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "The backup failed. Try again." };
  } finally {
    running = false;
  }
}
