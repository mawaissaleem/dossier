"use server";

import { refresh } from "next/cache";
import { getFileDeleteImpact, type FileDeleteImpact } from "@/lib/db/files";
import { checkApplicationFiles, type CheckFilesResult } from "@/lib/files/check";
import { deleteStoredFile } from "@/lib/files/remove";
import { isId } from "@/lib/ids";

// Runs on any POST, so the id is checked here. The Host allow-list is proxy.ts (it runs before server actions). refresh() re-renders the badges.
export async function checkFiles(applicationId: number): Promise<CheckFilesResult> {
  if (!isId(applicationId)) return { ok: false, error: "Application not found." };
  try {
    const r = await checkApplicationFiles(applicationId);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "The check failed. Try again." };
  }
}

// Read on each dialog open, so the warning is never stale page data (FR-5.8).
export async function fetchFileDeleteImpact(id: number): Promise<({ ok: true } & FileDeleteImpact) | { ok: false; error: string }> {
  if (!isId(id)) return { ok: false, error: "File not found." };
  const impact = await getFileDeleteImpact(id);
  return impact ? { ok: true, ...impact } : { ok: false, error: "File not found. It may already be deleted." };
}

// `confirm` must be literally true: the UI sets it only after the user saw what will be lost (NFR-4), and for a file in submissions after the extra
// "I understand" step. `expectedSubmissions` is the count the dialog showed; the data layer refuses if it changed since. Runs on any POST, so checked here.
export async function deleteFile(id: number, confirm: boolean, expectedSubmissions: number): Promise<{ ok: true; kept: boolean } | { ok: false; error: string }> {
  if (confirm !== true || !Number.isSafeInteger(expectedSubmissions) || expectedSubmissions < 0) return { ok: false, error: "Deleting must be confirmed." };
  if (!isId(id)) return { ok: false, error: "File not found." };
  try {
    const r = await deleteStoredFile(id, expectedSubmissions);
    if (r.ok) refresh();
    return r;
  } catch (e) {
    console.error("Delete file failed", e);
    return { ok: false, error: "Could not delete the file. Try again." };
  }
}
