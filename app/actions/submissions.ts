"use server";

import { refresh } from "next/cache";
import { applicationExists, listApplicationFiles } from "@/lib/db/files";
import { isId } from "@/lib/ids";
import { createManualSubmission, submitWithStatus, updateSubmissionNote } from "@/lib/db/submissions";
import { getApplicationExpectedLabels } from "@/lib/db/track-settings";

export type ReviewFile = { id: number; originalName: string; label: string; uploadDate: string };

// The files the review dialog lists, plus the track's expected labels for its warnings (FR-7.3), read on each open so the list is never stale page data. Newest upload date first.
export async function fetchReviewFiles(applicationId: number): Promise<{ ok: true; files: ReviewFile[]; expectedLabels: string[] } | { ok: false; error: string }> {
  if (!isId(applicationId) || !(await applicationExists(applicationId))) return { ok: false, error: "Application not found." };
  const list = await listApplicationFiles(applicationId);
  return { ok: true, files: list.map(({ id, originalName, label, uploadDate }) => ({ id, originalName, label, uploadDate })), expectedLabels: await getApplicationExpectedLabels(applicationId) };
}

const MAX_FILES = 1000; // bound on the payload, far above any real application

// Confirm step of the submission review (FR-7.2): status change + first submission, both or neither. Runs on any POST, so every
// argument is checked here before the data layer sees it (the date and note are validated there, with the same rules as a manual submission).
// refresh() only on success, so a refused review keeps the dialog's state.
export async function confirmSubmittedStatus(applicationId: number, columnId: number, optionId: number, fileIds: number[], date: string, note: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isId(applicationId)) return { ok: false, error: "Application not found." };
  if (!isId(columnId)) return { ok: false, error: "Status column not found. Reload the page and try again." };
  if (!isId(optionId)) return { ok: false, error: "Choose a valid option." };
  if (!Array.isArray(fileIds) || fileIds.length > MAX_FILES || !fileIds.every(isId)) return { ok: false, error: "Invalid file list." };
  if (typeof date !== "string") return { ok: false, error: "Use a real date as YYYY-MM-DD." };
  if (note !== null && typeof note !== "string") return { ok: false, error: "Invalid note." };
  const r = await submitWithStatus(applicationId, columnId, optionId, fileIds, date, note);
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

// "New submission" (FR-7.4): chosen files, a date, a note, and optionally a status change saved with it. `status` null = keep the current one.
// Same argument checks as the review above; at least one file is required here (the data layer enforces it too).
export async function addSubmission(applicationId: number, fileIds: number[], date: string, note: string | null, status: { columnId: number; optionId: number } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isId(applicationId)) return { ok: false, error: "Application not found." };
  if (!Array.isArray(fileIds) || fileIds.length > MAX_FILES || !fileIds.every(isId)) return { ok: false, error: "Invalid file list." };
  if (typeof date !== "string") return { ok: false, error: "Use a real date as YYYY-MM-DD." };
  if (note !== null && typeof note !== "string") return { ok: false, error: "Invalid note." };
  if (status !== null && (typeof status !== "object" || !isId(status.columnId) || !isId(status.optionId))) return { ok: false, error: "Choose a valid status." };
  const r = await createManualSubmission(applicationId, fileIds, date, note, status && { columnId: status.columnId, optionId: status.optionId });
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

// "Edit note" on a timeline item (FR-7.6). Runs on any POST, so the id and the note type are checked here; the length is checked in the data layer.
// Only the note can change: there is no action for a submission's date or files, or for deleting one.
export async function editSubmissionNote(id: number, note: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isId(id)) return { ok: false, error: "Submission not found." };
  if (note !== null && typeof note !== "string") return { ok: false, error: "Invalid note." };
  const r = await updateSubmissionNote(id, note);
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}
