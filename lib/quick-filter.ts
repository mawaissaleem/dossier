// Pure helpers for the quick status/priority chips (4.3): no DB or React imports (type-only imports are erased).
// The chips only read the filter state of lib/filter.ts and write it back with toggleFilter; there is no second filter mechanism.
import { isPriority } from "./priority";
import type { ApplicationRow } from "./db/applications";
import type { ColumnItem } from "./db/columns";
import { filterRows, type Filter } from "./filter";

// Status (the isStatus column), then Priority (the same rule as the add form's essentials). Hidden columns are included on purpose: status is
// special and a hidden filter column still filters. A track without one just omits it. With two Priority columns the first in column order wins.
export function quickColumns<T extends Pick<ColumnItem, "name" | "type" | "isStatus">>(cols: T[]): T[] {
  const status = cols.find((c) => c.isStatus && c.type === "single_select");
  return [status, cols.find((c) => c !== status && isPriority(c))].filter((c): c is T => c !== undefined);
}

// Row count per option id of `col`. Counts ignore the column's own filter but respect every other one, so a chip predicts what clicking it
// gives (an unpicked sibling chip would add its rows). Rows with no value or a deleted option are not counted (there is no chip for them).
export function optionCounts(rows: ApplicationRow[], columns: Pick<ColumnItem, "id" | "type" | "options">[], filters: Filter[], col: Pick<ColumnItem, "id" | "options">): Map<number, number> {
  const counts = new Map(col.options.map((o) => [o.id, 0]));
  for (const r of filterRows(rows, columns, filters.filter((f) => f.id !== col.id))) {
    const v = r.values[col.id];
    if (typeof v === "number" && counts.has(v)) counts.set(v, counts.get(v)! + 1);
  }
  return counts;
}
