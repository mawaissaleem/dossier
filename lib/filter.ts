// Pure single-select filtering: no DB or React imports (type-only imports are erased). Runs client-side before the sort (filter, then sort),
// on the rows the server page already sent. The state is a plain Filter[] so a quick-filter chip (4.3) only has to call toggleFilter.
//
// Semantics: options of one column are OR (a column's "(Blank)" is one more option); different columns are AND.
// "Blank" = no value, or a value that is not an option of the column any more (deleted option). Hidden columns still filter (the chip stays visible).
//
// URL form, one repeated param per filtered column: ?f=<columnId>:<token>.<token>&f=<columnId>:<token>
// where token is an option id or the word "blank", e.g. ?f=3:10.12.blank&f=5:blank (numeric column id, not "col-<n>").
import type { ApplicationRow } from "./db/applications";
import type { ColumnItem } from "./db/columns";

export type Filter = { id: number; options: number[]; blank: boolean }; // id = column id
export type Token = number | "blank";
type Col = Pick<ColumnItem, "id" | "type" | "options">;

const MAX_PARAMS = 50; // params read; a track has at most 200 columns, no real URL needs more
const MAX_LENGTH = 1000; // chars per param
const ENTRY = /^(\d{1,15}):((?:\d{1,15}|blank)(?:\.(?:\d{1,15}|blank))*)$/;

const selectCol = (columns: Col[], id: number) => columns.find((c) => c.id === id && c.type === "single_select");

// Reads the `f` params against the current columns. Malformed, oversized, repeated, unknown-column and non-select entries are ignored, never an error.
// Options that no longer exist are dropped; a filter left with nothing is dropped. Options come back in the column's own order (canonical).
export function parseFilters(raw: string[], columns: Col[]): Filter[] {
  const out: Filter[] = [];
  for (const s of raw.slice(0, MAX_PARAMS)) {
    const m = s.length <= MAX_LENGTH ? ENTRY.exec(s) : null;
    if (!m) continue;
    const id = Number(m[1]);
    const col = selectCol(columns, id);
    if (!col || out.some((f) => f.id === id)) continue;
    const tokens = new Set(m[2].split("."));
    const options = col.options.map((o) => o.id).filter((oid) => tokens.has(String(oid)));
    const blank = tokens.has("blank");
    if (options.length || blank) out.push({ id, options, blank });
  }
  return out;
}

// New query string (no "?") with the filters set; other params (sort, dir) are kept. Empty filters are not written.
export function withFilters(search: string, filters: Filter[]): string {
  const p = new URLSearchParams(search);
  p.delete("f");
  for (const f of filters) {
    const tokens = [...f.options, ...(f.blank ? ["blank"] : [])];
    if (tokens.length) p.append("f", `${f.id}:${tokens.join(".")}`);
  }
  return p.toString();
}

// Ticks or unticks one option (or blank) of a column. A column left with nothing is removed; a new column goes last.
export function toggleFilter(filters: Filter[], id: number, token: Token): Filter[] {
  const cur = filters.find((f) => f.id === id) ?? { id, options: [], blank: false };
  const next: Filter =
    token === "blank" ? { ...cur, blank: !cur.blank } : { ...cur, options: cur.options.includes(token) ? cur.options.filter((o) => o !== token) : [...cur.options, token] };
  const rest = filters.filter((f) => f.id !== id);
  if (!next.options.length && !next.blank) return rest;
  return filters.some((f) => f.id === id) ? filters.map((f) => (f.id === id ? next : f)) : [...rest, next];
}

// Returns `rows` itself when nothing applies. A filter whose column is gone (or not a single-select) is skipped.
// Each row is checked once per filter: a known option must be picked, anything else counts as blank.
export function filterRows(rows: ApplicationRow[], columns: Col[], filters: Filter[]): ApplicationRow[] {
  const active = filters.flatMap((f) => {
    const col = selectCol(columns, f.id);
    return col ? [{ id: f.id, pick: new Set(f.options), blank: f.blank, known: new Set(col.options.map((o) => o.id)) }] : [];
  });
  if (active.length === 0) return rows;
  return rows.filter((r) =>
    active.every((a) => {
      const v = r.values[a.id];
      return typeof v === "number" && a.known.has(v) ? a.pick.has(v) : a.blank;
    }),
  );
}
