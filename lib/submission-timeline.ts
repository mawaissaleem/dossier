// Pure (no DB, no UI). Wording for the submissions timeline (FR-7.9).
export function fileCountLabel(n: number): string {
  return n === 0 ? "No files" : n === 1 ? "1 file" : `${n} files`;
}
