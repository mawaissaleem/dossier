"use server";

import { refresh } from "next/cache";
import { setFilesRoot } from "@/lib/db/settings";
import { setExpectedLabels, setSubmittedStatuses } from "@/lib/db/track-settings";
import { validateFilesRoot, type FilesRootResult } from "@/lib/files/root";

// Validate, then save; nothing is saved on error. Stored files are not moved (relocate is a later task).
export async function saveFilesRoot(input: string): Promise<FilesRootResult> {
  const r = await validateFilesRoot(input); // also rejects non-strings: this runs on any POST
  if (!r.ok) return r;
  try {
    await setFilesRoot(r.path);
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
  refresh();
  return r;
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
