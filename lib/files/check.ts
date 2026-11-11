// Server-only. "Check files" (8.7, FR-5.5 "verifies hashes on demand"): re-verifies every file of one application with verifyStoredFile and
// records each result. No bytes leave this function. One file at a time, so at most one file (<= the upload cap) is in memory.
import { applicationExists, listApplicationFileIds } from "../db/files";
import { checkSummary, type CheckCounts } from "../file-integrity";
import { verifyStoredFile } from "./open";

export type CheckFilesResult = { ok: true; summary: string; counts: CheckCounts } | { ok: false; error: string };

export async function checkApplicationFiles(applicationId: number): Promise<CheckFilesResult> {
  if (!(await applicationExists(applicationId))) return { ok: false, error: "Application not found." };
  const counts: CheckCounts = { ok: 0, mismatch: 0, missing: 0, failed: 0 };
  for (const id of await listApplicationFileIds(applicationId)) {
    const r = await verifyStoredFile(id);
    if (r.ok) counts[r.integrity]++;
    else if (r.kind === "missing") counts.missing++;
    else if (r.kind === "setup") return { ok: false, error: r.error }; // no files folder: every file would fail the same way
    else counts.failed++;
  }
  return { ok: true, summary: checkSummary(counts), counts };
}
