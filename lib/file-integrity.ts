// Pure (no fs, no DB, no React). Wording for the file integrity flag (8.7, FR-5.5).
import type { IntegrityState } from "./db/schema";

// null for ok: nothing is shown for a file that matched at its last check.
export function integrityLabel(state: IntegrityState): string | null {
  return state === "mismatch" ? "Changed since upload" : state === "missing" ? "Missing" : null;
}

export type CheckCounts = { ok: number; mismatch: number; missing: number; failed: number };

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

// "All 3 files OK" / "1 file changed, 1 missing" / "2 files could not be read". `failed` = the check could not read it (not a verdict on the file).
export function checkSummary(c: CheckCounts): string {
  const total = c.ok + c.mismatch + c.missing + c.failed;
  if (total === 0) return "No files to check";
  if (c.ok === total) return `All ${files(total)} OK`;
  const parts = [c.mismatch && `${files(c.mismatch)} changed`, c.missing && `${c.missing} missing`, c.failed && `${c.failed} could not be read`].filter(Boolean);
  return parts.join(", ");
}
