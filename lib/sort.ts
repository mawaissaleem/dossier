// Pure table sorting: no DB or React imports (type-only imports are erased). Runs client-side on the rows the server page already sent:
// at 500 rows one memoised in-memory sort is instant and needs no round trip (4.5 handles larger scale), and the order stays shareable via the URL.
import type { ApplicationRow } from "./db/applications";
import type { ColumnItem } from "./db/columns";
import { columnId } from "./column-id";

export type SortDir = "asc" | "desc";
// id is the table column id: "title" or columnId(col) ("col-<n>").
export type Sort = { id: string; dir: SortDir };

// Fixed locale so the order does not depend on the machine; numeric makes "Job 2" sort before "Job 10", base ignores case and accents.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

// Reads ?sort=<id>&dir=asc|desc. Anything unknown, half-given or not a visible column means default order (null), never an error.
export function parseSort(sort: string | null | undefined, dir: string | null | undefined, visible: Pick<ColumnItem, "id">[]): Sort | null {
  if (dir !== "asc" && dir !== "desc") return null;
  if (sort !== "title" && !visible.some((c) => columnId(c) === sort)) return null;
  return { id: sort as string, dir };
}

// Click cycle: ascending, then descending, then off. Clicking another column starts it at ascending.
export const nextSort = (cur: Sort | null, id: string): Sort | null =>
  cur?.id !== id ? { id, dir: "asc" } : cur.dir === "asc" ? { id, dir: "desc" } : null;

// New query string (no "?") with sort/dir set or removed; other params are kept.
export function withSort(search: string, sort: Sort | null): string {
  const p = new URLSearchParams(search);
  p.delete("sort");
  p.delete("dir");
  if (sort) {
    p.set("sort", sort.id);
    p.set("dir", sort.dir);
  }
  return p.toString();
}

// The comparable value of one cell, or null for blank (empty text, no value, a deleted option).
// Checkbox is never blank: unchecked (0) sorts before checked (1). Select sorts by the option's position, not its label.
function sortValue(col: ColumnItem | undefined, row: ApplicationRow): string | number | null {
  if (!col) return row.title; // Title
  const v = row.values[col.id];
  switch (col.type) {
    case "checkbox":
      return v === true ? 1 : 0;
    case "number":
      return typeof v === "number" ? v : null;
    case "single_select":
      return col.options.find((o) => o.id === v)?.position ?? null;
    default:
      return typeof v === "string" && v !== "" ? v : null; // text, date, link
  }
}

// Returns `rows` itself when there is no sort (the server's newest-first order). Blanks are last in both directions;
// ties fall back to newest first (id desc) in both directions, so the order is stable.
export function sortRows(rows: ApplicationRow[], visible: ColumnItem[], sort: Sort | null): ApplicationRow[] {
  if (!sort) return rows;
  const col = visible.find((c) => columnId(c) === sort.id);
  const plain = col?.type === "date"; // ISO dates: plain string order is chronological
  const sign = sort.dir === "asc" ? 1 : -1;
  const keyed = rows.map((row) => ({ row, v: sortValue(col, row) }));
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) {
      if (a.v !== b.v) return a.v === null ? 1 : -1;
    } else if (a.v !== b.v) {
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : plain ? (a.v < b.v ? -1 : 1) : collator.compare(String(a.v), String(b.v));
      if (c !== 0) return sign * c;
    }
    return b.row.id - a.row.id;
  });
  return keyed.map((k) => k.row);
}
