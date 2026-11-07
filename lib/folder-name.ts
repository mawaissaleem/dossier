// Pure (no fs, no DB). The application folder name (FR-5.2): "<identifying values joined by _>_YYYY-MM", e.g. Acme_Data_Engineer_2026-10.
//  - Track "Job" (name, trimmed, any case): the Company and Role text columns. Track "PhD": University and Program.
//    Columns are found by name (trimmed, case-insensitive), never by id. Any other track, a missing column, or a blank value
//    (also one that is only illegal characters) falls back to the application title; a blank title falls back to "Application_<id>".
//  - YYYY-MM is the month of the first upload's upload date (editable by the user, so it can differ from today).
//  - Only the FIRST upload picks a name. Afterwards the folder is read back from the stored file paths, so editing the company never
//    renames or moves anything. Sanitising (FR-6.6) is safeName; the name part is capped so the whole name stays within 80 characters
//    and 200 UTF-8 bytes (a _NNN suffix still fits the 255-byte limit). The upload date must be a real calendar date.
// uniqueFolderName adds _2, _3, ... when a name is taken, comparing case-insensitively (macOS and Windows folders are case-blind).
import { parseCell } from "./cells";
import { safeName } from "./safe-name";

export type FolderNameInput = {
  id: number;
  title: string;
  trackName: string;
  cells: { name: string; value: string | null }[]; // the application's text columns
  uploadDate: string; // YYYY-MM-DD
};

const PAIRS: Record<string, [string, string]> = { job: ["company", "role"], phd: ["university", "program"] };
const MAX = 80;
const MAX_BYTES = 200;
const key = (s: string) => s.trim().toLowerCase();

export function folderBaseName({ id, title, trackName, cells, uploadDate }: FolderNameInput): string {
  const date = parseCell("date", uploadDate); // blank parses as ok/null (a cleared cell), so require a value
  if (!date.ok || date.value === null || uploadDate !== uploadDate.trim()) throw new Error("uploadDate must be a valid YYYY-MM-DD date.");
  const month = uploadDate.slice(0, 7);
  const [room, roomBytes] = [MAX - month.length - 1, MAX_BYTES - month.length - 1]; // month is ASCII: 8 chars = 8 bytes
  const parts = (PAIRS[key(trackName)] ?? []).map((col) => safeName(cells.find((c) => key(c.name) === col)?.value ?? "", ""));
  const name = parts.length && parts.every(Boolean) ? safeName(parts.join("_"), "", room, roomBytes) : safeName(title, `Application_${id}`, room, roomBytes);
  return `${name}_${month}`;
}

export function uniqueFolderName(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (t) => t.normalize("NFC").toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}_${n}`;
    if (!used.has(candidate.normalize("NFC").toLowerCase())) return candidate;
  }
}
