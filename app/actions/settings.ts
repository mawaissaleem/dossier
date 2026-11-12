"use server";

import { refresh, revalidatePath } from "next/cache";
import { listLiveFiles, switchFilesRoot } from "@/lib/db/files";
import { getFilesRoot } from "@/lib/db/settings";
import { resetPlannerSettings, setCapacity, setOptionBuffer, setPlannerSlots, setRankingRules, setStillToDo } from "@/lib/db/planner";
import { setExpectedLabels, setSubmittedStatuses } from "@/lib/db/track-settings";
import { tryLock } from "@/lib/files/lock";
import { moveStoredFiles, repointStoredFiles, type MoveResult, type RepointResult } from "@/lib/files/relocate";
import { validateFilesRoot, type FilesRootResult } from "@/lib/files/root";
import { sumBytes } from "@/lib/relocate";

// First-time setup (or the same folder again): validate, then save; nothing is saved on error. Once live files exist, a different folder must go
// through Move or Re-point (8.10): a plain save would leave every stored file unreachable. Takes the shared lock (lib/files/lock.ts) so it cannot
// run during a backup, restore or move, or while an upload is running.
export async function saveFilesRoot(input: string): Promise<FilesRootResult> {
  const r = await validateFilesRoot(input); // also rejects non-strings: this runs on any POST
  if (!r.ok) return r;
  const lock = tryLock("move");
  if (!lock.ok) return lock;
  try {
    const live = await listLiveFiles();
    if (live.length > 0 && r.path !== (await getFilesRoot())) {
      return { ok: false, error: "Your stored files are in the current folder. Choose Move (Dossier moves them) or Re-point (you already moved the folder) instead of Save." };
    }
    if (!(await switchFilesRoot(r.path, live))) return { ok: false, error: "Your files changed while saving. Try again." };
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  } finally {
    lock.release();
  }
  refresh();
  return r;
}

// The Move confirm's impact, read fresh on every open (DESIGN.md): how many live files and bytes will move, and from where.
export async function fetchMoveImpact(): Promise<{ ok: true; fileCount: number; totalBytes: number; from: string | null } | { ok: false; error: string }> {
  try {
    const live = await listLiveFiles();
    return { ok: true, fileCount: live.length, totalBytes: sumBytes(live), from: await getFilesRoot() };
  } catch {
    return { ok: false, error: "Could not count your files. Try again." };
  }
}

// Move (8.10), after the confirmation. `expected` = the count and size the dialog showed; the move refuses if they changed.
export async function moveFilesRoot(input: unknown, expected: unknown): Promise<MoveResult> {
  const lock = tryLock("move");
  if (!lock.ok) return lock;
  try {
    const r = await moveStoredFiles(input, expected);
    if (r.ok) revalidatePath("/", "layout");
    return r;
  } catch (e) {
    console.error("Move files root failed", e);
    return { ok: false, error: "The move failed. Your files folder was not changed. Try again." };
  } finally {
    lock.release();
  }
}

// Re-point (8.10): the user already moved the folder; saves it only if every stored file is there with its recorded size.
export async function repointFilesRoot(input: unknown): Promise<RepointResult> {
  const lock = tryLock("move");
  if (!lock.ok) return lock;
  try {
    const r = await repointStoredFiles(input);
    if (r.ok) revalidatePath("/", "layout");
    return r;
  } catch (e) {
    console.error("Re-point files root failed", e);
    return { ok: false, error: "Could not check that folder. Try again." };
  } finally {
    lock.release();
  }
}

// Which status options count as "submitted" for a track (FR-3.5). Validated here too: this runs on any POST.
export async function saveSubmittedStatuses(trackId: number, ids: number[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(trackId)) return { ok: false, error: "Track not found." };
  try {
    const r = await setSubmittedStatuses(trackId, ids);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// Expected file labels for a track (FR-7.3). Validated in the data layer: this runs on any POST.
export async function saveExpectedLabels(trackId: number, labels: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(trackId)) return { ok: false, error: "Track not found." };
  try {
    const r = await setExpectedLabels(trackId, labels);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// Planner engine slots for a track (FR-8.1). Validated in the data layer: this runs on any POST.
export async function savePlannerSlots(trackId: number, slots: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(trackId)) return { ok: false, error: "Track not found." };
  try {
    const r = await setPlannerSlots(trackId, slots);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// One option's buffer days (FR-8.2). Validated in the data layer: this runs on any POST.
export async function saveOptionBuffer(optionId: unknown, days: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await setOptionBuffer(optionId, days);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// Which status options are "still to do" for a track (FR-8.4). Validated in the data layer: this runs on any POST.
export async function saveStillToDo(trackId: number, ids: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(trackId)) return { ok: false, error: "Track not found." };
  try {
    const r = await setStillToDo(trackId, ids);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// The overdue and no-deadline ranking rules (FR-8.5, FR-8.6). Validated in the data layer: this runs on any POST.
export async function saveRankingRules(overdue: unknown, noDeadline: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await setRankingRules(overdue, noDeadline);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// The weekly capacity (FR-8.8). Validated in the data layer: this runs on any POST.
export async function saveCapacity(capacity: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await setCapacity(capacity);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
}

// Restores every planner rule to the shipped defaults (FR-8.11). Touches nothing outside the planner settings and buffers.
// `confirm` must be literally true: the UI sets it only after the confirm dialog (NFR-4); this runs on any POST.
export async function resetPlanner(confirm: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (confirm !== true) return { ok: false, error: "Resetting must be confirmed. Nothing was changed." };
  try {
    await resetPlannerSettings();
    refresh();
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reset. Nothing was changed." };
  }
}
