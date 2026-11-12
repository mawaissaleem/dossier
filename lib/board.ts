// Pure board grouping (no DB or React imports; type-only imports are erased). Cards are the rows the track page already loaded.
// One column per option of the status column, in option order, then "No status" last: rows with no value or a value that is not
// an option of the column any more (deleted option), the same "blank" rule as lib/filter.ts. "No status" is left out while empty.
// Cards inside a column are newest first (highest id), whatever order the rows come in.
import type { ApplicationRow } from "./db/applications";
import type { ColumnItem } from "./db/columns";
import { filterRows, type Filter } from "./filter";
import { isDeadline, isPriority } from "./priority";

export type BoardColumn = { key: string; optionId: number | null; label: string; color: string; cards: ApplicationRow[] };

export const NO_STATUS = "No status";

// Accessible name of a column region, e.g. "Applied, 12 applications".
export const columnLabel = (label: string, count: number) => `${label}, ${count} ${count === 1 ? "application" : "applications"}`;

export function groupByStatus(rows: ApplicationRow[], status: Pick<ColumnItem, "id" | "options">): BoardColumn[] {
  const cols: BoardColumn[] = status.options.map((o) => ({ key: `opt-${o.id}`, optionId: o.id, label: o.label, color: o.color, cards: [] }));
  const byOption = new Map(cols.map((c) => [c.optionId, c]));
  const none: BoardColumn = { key: "none", optionId: null, label: NO_STATUS, color: "gray", cards: [] };
  for (const row of [...rows].sort((a, b) => b.id - a.id)) {
    const v = row.values[status.id];
    ((typeof v === "number" && byOption.get(v)) || none).cards.push(row);
  }
  return none.cards.length ? [...cols, none] : cols;
}

// FR-4.3: the board shows the rows the table shows. Filter first (the table's filterRows, so counts and cards match), then group; every status column
// stays, an excluded one just has no cards. `columns` = the track's single-select columns (the filter scope), as for filterRows.
export const boardGroups = (rows: ApplicationRow[], columns: Pick<ColumnItem, "id" | "type" | "options">[], filters: Filter[], status: Pick<ColumnItem, "id" | "options">) =>
  groupByStatus(filterRows(rows, columns, filters), status);

// True when the status filter leaves this column out (optionId null = No status, the "(Blank)" token). False without a status filter.
export function columnFilteredOut(filters: Filter[], statusId: number, optionId: number | null): boolean {
  const f = filters.find((x) => x.id === statusId);
  return !!f && !(optionId === null ? f.blank : f.options.includes(optionId));
}

// True when the filters hide `row` once `move` is applied: the card leaves the board, which is then told, not an error.
export const hiddenAfterMove = (row: ApplicationRow, columns: Pick<ColumnItem, "id" | "type" | "options">[], filters: Filter[], statusId: number, move: Move) =>
  filterRows(applyMove([row], statusId, move), columns, filters).length === 0;

// The columns a card shows besides the title: Priority and Deadline by the same name rules as the add form's essentials (trimmed,
// case-insensitive, first visible match in column order). undefined = the track has none, so the card omits that line.
export function cardColumns<T extends Pick<ColumnItem, "name" | "type" | "hidden">>(cols: T[]): { priority?: T; deadline?: T } {
  return { priority: cols.find((c) => !c.hidden && isPriority(c)), deadline: cols.find((c) => !c.hidden && isDeadline(c)) };
}

// A status change the user just asked for, shown at once while the server answers (FR-4.2). `from` is the raw stored value the card started
// with: the move only applies while the row still has it, so once the refreshed rows carry the saved status (or someone else changed it) the
// override switches itself off and the server's rows win. Dropping it (failure, cancelled review) is what rolls the card back.
// to = an option id, or null for "No status" (a blank status, the same as the table's "— (blank)").
export type Move = { rowId: number; from: ApplicationRow["values"][number]; to: number | null };

// The move of `rowId` into the column whose option is `to`, or null when it would change nothing (same column, unknown card or option).
// Order inside a column is derived (newest first), so a drop only ever changes the status, never a position.
export function planMove(groups: BoardColumn[], statusId: number, rowId: number, to: number | null): Move | null {
  const src = groups.find((g) => g.cards.some((c) => c.id === rowId));
  if (!src || src.optionId === to || (to !== null && !groups.some((g) => g.optionId === to))) return null;
  return { rowId, from: src.cards.find((c) => c.id === rowId)!.values[statusId] ?? null, to };
}

export function applyMove(rows: ApplicationRow[], statusId: number, move: Move | null): ApplicationRow[] {
  if (!move) return rows;
  return rows.map((r) => (r.id === move.rowId && (r.values[statusId] ?? null) === move.from ? { ...r, values: { ...r.values, [statusId]: move.to } } : r));
}

// Keyboard drag geometry. Columns sit side by side with different heights, so only x decides: a centre-to-centre distance (closestCenter)
// picks a short neighbour over a tall column when the card sits at the tall column's top.
export type Span = { left: number; width: number };

// The column under x: the one whose span contains it, else the horizontally nearest (x in the gap between two columns).
export function columnAtX<T extends Span>(x: number, cols: T[]): T | undefined {
  const off = (c: Span) => Math.max(c.left - x, x - c.left - c.width, 0);
  return cols.reduce<T | undefined>((best, c) => (!best || off(c) < off(best) ? c : best), undefined);
}

// The nearest column whose centre lies more than half a column left (dir -1) or right (dir 1) of x, or undefined at the edge.
// Half a width, not a pixel: a list's scrollbar shifts the card left of its own column's centre, which must not count as "to the right".
export function nextColumn<T extends Span>(x: number, dir: 1 | -1, cols: T[]): T | undefined {
  const d = (c: Span) => (c.left + c.width / 2 - x) * dir;
  return cols.filter((c) => d(c) > c.width / 2).reduce<T | undefined>((best, c) => (!best || d(c) < d(best) ? c : best), undefined);
}
