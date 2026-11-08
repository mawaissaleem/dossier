// Pure (no DB, no UI): the expected file labels of a track (FR-7.3, FR-13.3) and the rule that matches them to file labels.
import { MAX_LABEL } from "./upload-form";

export const MAX_EXPECTED_LABELS = 20;

// Matching rule (used by the missing-label warning in 6.5): a file label satisfies an expected label when they are
// equal after trim and lower-casing. "cv " satisfies "CV"; "Cover letter" does not satisfy "Cover-letter".
export const labelKey = (label: string) => label.trim().toLowerCase();
export const labelMatches = (fileLabel: string, expected: string) => labelKey(fileLabel) === labelKey(expected);

// The expected labels with no matching file label, in the expected order.
export const missingLabels = (expected: string[], fileLabels: string[]) =>
  expected.filter((e) => !fileLabels.some((f) => labelMatches(f, e)));

// What to warn about before a submission is created (FR-7.3), given the labels of the files going into it. Messages are shown as they are;
// empty = no warning. Used by the review dialog (6.4) and by the manual submission (6.6).
export function submissionWarnings(selectedLabels: string[], expected: string[]): string[] {
  const none = selectedLabels.length === 0 ? ["No files are selected."] : [];
  return [...none, ...missingLabels(expected, selectedLabels).map((l) => `No file labelled ${l}`)];
}

// Parsed `track.<id>.expected_labels` setting. Never saved or unreadable -> [] (no label warning); entries that are not usable are dropped.
export function resolveExpectedLabels(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of stored) {
    if (typeof x !== "string" || x.trim() === "" || seen.has(labelKey(x))) continue;
    seen.add(labelKey(x));
    out.push(x.trim());
  }
  return out;
}

// The labels to save (trimmed, order kept), or the first error. An empty list is allowed.
export function checkExpectedLabels(input: unknown): { labels: string[] } | { error: string } {
  if (!Array.isArray(input) || !input.every((x) => typeof x === "string")) return { error: "Expected labels must be a list of text." };
  if (input.length > MAX_EXPECTED_LABELS) return { error: `At most ${MAX_EXPECTED_LABELS} expected labels.` };
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of input as string[]) {
    const l = raw.trim();
    if (l === "") return { error: "A label cannot be blank." };
    if (l.length > MAX_LABEL || /[\u0000-\u001f\u007f-\u009f]/.test(l)) return { error: `A label must be one line of at most ${MAX_LABEL} characters.` };
    if (seen.has(labelKey(l))) return { error: `"${l}" is already in the list.` };
    seen.add(labelKey(l));
    labels.push(l);
  }
  return { labels };
}
