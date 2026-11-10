"use server";

import { refresh } from "next/cache";
import { archiveApplication as setArchived, getDeleteImpact, type DeleteImpact } from "@/lib/db/applications";
import { deleteApplicationWithFiles, type DeleteWithFilesResult } from "@/lib/files/remove";
import { isId } from "@/lib/ids";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Runs on any POST, so the arguments are checked here, not trusted from the TS types.
export async function archiveApplication(id: number, archived: boolean): Promise<ActionResult> {
  if (!isId(id) || typeof archived !== "boolean") return { ok: false, error: "Application not found." };
  if (!(await setArchived(id, archived))) return { ok: false, error: "Application not found." };
  refresh();
  return { ok: true };
}

// Read on each dialog open so the counts are never stale page data.
export async function fetchDeleteImpact(id: number): Promise<({ ok: true } & DeleteImpact) | { ok: false; error: string }> {
  if (!isId(id)) return { ok: false, error: "Application not found." };
  const impact = await getDeleteImpact(id);
  return impact ? { ok: true, ...impact } : { ok: false, error: "Application not found." };
}

const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

// `confirm` must be literally true: the UI sets it only after the user saw what will be lost (FR-1.9, NFR-4). `expected` is the impact
// the dialog showed; the data layer refuses if it changed since.
// The application's files are removed from disk too; a leftover is returned as `warning` (lib/files/remove.ts).
// No refresh(): the detail page would re-render as a 404 before the client navigates to the track page (trackId).
export async function deleteApplication(id: number, confirm: boolean, expected: { cellCount: number; fileCount: number; submissionCount: number; noteCount: number }): Promise<DeleteWithFilesResult> {
  if (confirm !== true || typeof expected !== "object" || expected === null || !count(expected.cellCount) || !count(expected.fileCount) || !count(expected.submissionCount) || !count(expected.noteCount)) {
    return { ok: false, error: "Deleting must be confirmed." };
  }
  if (!isId(id)) return { ok: false, error: "Application not found." };
  return deleteApplicationWithFiles(id, { cellCount: expected.cellCount, fileCount: expected.fileCount, submissionCount: expected.submissionCount, noteCount: expected.noteCount });
}
