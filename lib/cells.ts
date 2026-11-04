// Pure cell-value rules: no DB or UI imports. Maps a column type to its typed cell_values field and validates raw input.
import type { ColumnType } from "./db/schema";

export type CellField = "valueText" | "valueNumber" | "valueDate" | "valueBool" | "valueOptionId";
export type CellScalar = string | number | boolean;
// value null = blank (FR-1.4): the caller deletes the row instead of storing it.
export type ParsedCell = { ok: true; value: CellScalar | null } | { ok: false; error: string };

export const CELL_FIELD: Record<ColumnType, CellField> = {
  text: "valueText",
  link: "valueText",
  number: "valueNumber",
  date: "valueDate",
  checkbox: "valueBool",
  single_select: "valueOptionId",
};

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const bad = (error: string): ParsedCell => ({ ok: false, error });
const good = (value: CellScalar | null): ParsedCell => ({ ok: true, value });

// The only way a link value reaches an href: http(s) with a host and no whitespace/control characters, else null.
// Returns the normalised URL (new URL().href), so "//example.com" and "https:////example.com" both become "https://example.com/".
// The URL parser silently drops tabs and newlines, so they are rejected up front rather than stored.
export function safeHref(value: string): string | null {
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

// Short readable text for a link: host + path, no bare trailing slash, cut at `max` characters. Falls back to the input if it is not a URL.
export function linkLabel(href: string, max = 40): string {
  let text = href;
  try {
    const u = new URL(href);
    text = u.host + (u.pathname === "/" ? "" : u.pathname) + u.search;
  } catch {}
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function parseCell(type: ColumnType, raw: unknown): ParsedCell {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return good(null);
  switch (type) {
    case "text":
      return typeof raw === "string" ? good(raw.trim()) : bad("Text must be a string.");
    case "number": {
      // Plain decimals only: Number() would also take "0x10" (16) and "1e3" (1000), which surprise someone typing into a cell.
      const n = typeof raw === "number" ? raw : typeof raw === "string" && DECIMAL.test(raw.trim()) ? Number(raw.trim()) : NaN;
      return Number.isFinite(n) ? good(n) : bad("Enter a valid number.");
    }
    case "date": {
      if (typeof raw !== "string") return bad("Enter a date as YYYY-MM-DD.");
      const s = raw.trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      // Round-trip through UTC so 2026-02-30 is rejected rather than rolled over.
      const ok = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === s;
      return ok ? good(s) : bad("Enter a valid date as YYYY-MM-DD.");
    }
    case "link": {
      if (typeof raw !== "string") return bad("Link must be a string.");
      let s = raw.trim();
      // A bare "example.com" gets https:// prepended. "host:8080" has no scheme (digit after the colon).
      if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) s = `https://${s}`;
      const href = safeHref(s);
      return href ? good(href) : bad("Enter a valid http or https link, without spaces.");
    }
    case "checkbox":
      return typeof raw === "boolean" ? good(raw) : bad("Checkbox must be true or false.");
    case "single_select": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
      return Number.isSafeInteger(n) ? good(n) : bad("Choose a valid option.");
    }
  }
}

// Reads the typed value for `type` from a cell_values-shaped row, ignoring its other fields. null = blank.
export function readCell(type: ColumnType, row: Partial<Record<CellField, CellScalar | null>>): CellScalar | null {
  return row[CELL_FIELD[type]] ?? null;
}

// Column default_value encoding: raw text in columns.default_value, one rule per type. A default is a typed value that parseCell
// accepted, stored as String(value): text/link as given (link already normalised), number as its canonical decimal ("4.5"),
// date as YYYY-MM-DD, checkbox as "true"/"false", single_select as the option id ("12"). null (no default) is the NULL column.
export const encodeDefault = (value: CellScalar): string => String(value);

// Typed default for `type`, or null (= no default) when the text is empty or invalid, e.g. hand-edited. Callers skip null, so a
// bad default never blocks creating an application. A single_select result still has to be checked against the column's options.
export function decodeDefault(type: ColumnType, text: string | null): CellScalar | null {
  if (text === null) return null;
  let raw: unknown = text;
  if (type === "checkbox") raw = text === "true" ? true : text === "false" ? false : null;
  // Number() would also take "0x10" and " 5"; only the exact text encodeDefault writes is accepted.
  else if (type === "number") raw = String(Number(text)) === text ? Number(text) : null;
  const p = parseCell(type, raw);
  return p.ok ? p.value : null;
}
