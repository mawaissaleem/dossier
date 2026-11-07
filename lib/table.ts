// Pure table logic: no DB or React imports (type-only imports below are erased). Builds TanStack column defs from a track's column list.
import { createColumnHelper, tableFeatures } from "@tanstack/react-table";
import type { ApplicationRow } from "./db/applications";
import type { ColumnItem } from "./db/columns";
import { columnId } from "./column-id";
import { findOption } from "./options";

// Stable row identity by application id, not array index: a new application at the top must not shift edit state onto another row.
export const getRowId = (r: ApplicationRow) => String(r.id);
// Text-box editor kinds (checkbox has its own cell). Narrows a column type without a cast; null = no inline editor yet.
export type EditorKind = "text" | "number" | "date" | "link";
export const editorKind = (type: ColumnItem["type"]): EditorKind | null =>
  type === "text" || type === "number" || type === "date" || type === "link" ? type : null;
export { columnId };

// Core features only for now; sorting, filtering and editing register theirs in later tasks.
export const features = tableFeatures({});
const helper = createColumnHelper<typeof features, ApplicationRow>();

// Read-only display text for one cell. A missing or null value is blank (FR-2.1), including a column added after the rows were read.
export function formatCell(col: Pick<ColumnItem, "type" | "options">, v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  switch (col.type) {
    case "checkbox":
      return v ? "✓" : "";
    case "single_select":
      return findOption(col.options, v)?.label ?? "";
    case "number":
      return typeof v === "number" ? plainNumber(v) : String(v);
    default:
      return String(v); // text, date (YYYY-MM-DD as stored), link
  }
}

// String(n) without exponent form (5e-7 -> 0.0000005, 1e21 -> 1000000000000000000000), so the editor's draft passes the plain-decimal parser.
// Shifts the shortest round-trip digits that String() gives, so the value is unchanged.
function plainNumber(n: number): string {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(String(n));
  if (!m) return String(n);
  const [, sign, d, frac = "", e] = m;
  const exp = Number(e);
  // String() only uses exponent form for exp >= 21 or <= -7, and frac has at most 16 digits, so the repeat counts are positive.
  return exp < 0 ? `${sign}0.${"0".repeat(-exp - 1)}${d}${frac}` : `${sign}${d}${frac}${"0".repeat(exp - frac.length)}`;
}

// Title first, then every non-hidden column in the order given (listColumns already sorts by position).
export function buildColumns(cols: ColumnItem[]) {
  return helper.columns([
    helper.accessor((r) => r.title, { id: "title", header: "Title" }),
    ...cols
      .filter((c) => !c.hidden)
      .map((c) =>
        helper.accessor((r) => r.values[c.id] ?? null, {
          id: columnId(c),
          header: c.name,
          cell: (info) => formatCell(c, info.getValue()),
        }),
      ),
  ]);
}
