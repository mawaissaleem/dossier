// Pure (no fs, no DB, no UI). The CSV export of a track's table (8.5, FR-12.4).
// Format: RFC 4180 (fields with a comma, quote, CR or LF are quoted, quotes doubled), CRLF line ends including the last, and a UTF-8 BOM
// so Excel reads non-ASCII ("Zürich") as UTF-8 instead of the system code page.
// Formula injection: a spreadsheet runs a text cell that starts with = + - @ tab or CR as a formula. Every STRING cell like that is
// written with a leading ' (the OWASP rule), so it shows as text. Number cells are written as plain numbers and never prefixed, so -5
// stays numeric; a text column holding "-5" does get the ' (it is text, we cannot know it is safe). Limit: the ' is visible when the
// file is read by a program, so a re-import must strip it.
export type CsvCell = string | number | null;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function field(c: CsvCell): string {
  if (c === null) return "";
  let s = typeof c === "number" ? String(c) : FORMULA_START.test(c) ? `'${c}` : c;
  if (NEEDS_QUOTES.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const toCsv = (rows: CsvCell[][]): string => "﻿" + rows.map((r) => r.map(field).join(",") + "\r\n").join("");

type Col = { id: number; name: string; type: string; options: { id: number; label: string }[] };
type Row = { title: string; archived: boolean; values: Record<number, string | number | boolean | null> };

// Header "Title", then every column in the order given (hidden ones too), then "Archived". One line per application in the order
// given. Values as the table shows them: a select shows its option label (an id with no option is blank), a checkbox Yes/No (blank
// stays blank), a date its stored YYYY-MM-DD, blank empty. Filters and sort are not applied: the caller passes every row.
export function trackCsv(cols: Col[], rows: Row[]): string {
  const cell = (c: Col, v: Row["values"][number] | undefined): CsvCell => {
    if (v === null || v === undefined) return null;
    if (c.type === "single_select") return c.options.find((o) => o.id === v)?.label ?? null;
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return v;
  };
  return toCsv([
    ["Title", ...cols.map((c) => c.name), "Archived"],
    ...rows.map((r) => [r.title, ...cols.map((c) => cell(c, r.values[c.id])), r.archived ? "Yes" : "No"]),
  ]);
}

// dossier-<track>-YYYYMMDD.csv from the local date; the track name is cut to letters and digits joined by "-".
export function exportFilename(trackName: string, now: Date): string {
  const slug = trackName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "track";
  const p = (n: number) => String(n).padStart(2, "0");
  return `dossier-${slug}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.csv`;
}
