// Server-only. See lib/db/tracks.ts for the convention.
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { encodeDefault, parseCell } from "../cells";
import type { ColumnType } from "./schema";
import { getDb } from "./client";
import { isUniqueViolation } from "./errors";
import { COLUMN_TYPES, applications, cellValues, columnOptions, columns, tracks } from "./schema";
import { getUserId } from "./user";

export type OptionItem = { id: number; label: string; color: string; position: number };
export type ColumnItem = {
  id: number;
  name: string;
  type: ColumnType;
  hidden: boolean;
  isStatus: boolean;
  defaultValue: string | null; // raw text, see encodeDefault/decodeDefault in lib/cells.ts (may be invalid or dangle, readers must check)
  options: OptionItem[]; // empty unless single_select
};

// Columns of the current user's track in display order (position, then id), hidden ones included with the flag.
// Two queries however many columns: columns, then all their options at once.
export async function listColumns(trackId: number): Promise<ColumnItem[]> {
  const db = getDb();
  const userId = getUserId();
  const cols = db
    .select({ id: columns.id, name: columns.name, type: columns.type, hidden: columns.hidden, isStatus: columns.isStatus, defaultValue: columns.defaultValue })
    .from(columns)
    .where(and(eq(columns.trackId, trackId), eq(columns.userId, userId)))
    .orderBy(asc(columns.position), asc(columns.id))
    .all();
  const selectIds = cols.filter((c) => c.type === "single_select").map((c) => c.id);
  const opts = selectIds.length
    ? db
        .select({ id: columnOptions.id, columnId: columnOptions.columnId, label: columnOptions.label, color: columnOptions.color, position: columnOptions.position })
        .from(columnOptions)
        .where(and(inArray(columnOptions.columnId, selectIds), eq(columnOptions.userId, userId)))
        .orderBy(asc(columnOptions.position), asc(columnOptions.id))
        .all()
    : [];
  return cols.map((c) => ({
    ...c,
    options: opts.filter((o) => o.columnId === c.id).map((o) => ({ id: o.id, label: o.label, color: o.color, position: o.position })),
  }));
}

export const MAX_COLUMN_NAME = 100;
export type AddColumnResult = { ok: true; id: number } | { ok: false; error: string };
export type ColumnResult = { ok: true } | { ok: false; error: string };

const DUP = { ok: false, error: "A column with that name already exists." } as const;

// Trimmed name, or the error. Shared by addColumn and renameColumn so the rules cannot drift.
function checkName(name: unknown): { name: string } | { error: string } {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return { error: "Name is required." };
  if (n.length > MAX_COLUMN_NAME) return { error: `Name must be at most ${MAX_COLUMN_NAME} characters.` };
  return { name: n };
}

// Appends a column after the last one (hidden=false, no default, no options). Inserts no cell rows: a missing row is blank (FR-2.1).
// Validates here too so the data layer is safe on its own; the unique index is case-sensitive, so the case-insensitive check is in code.
// No await between the checks and the insert, and better-sqlite3 is sync, so nothing can interleave.
export async function addColumn({ trackId, name, type }: { trackId: number; name: string; type: ColumnType }): Promise<AddColumnResult> {
  const checked = checkName(name);
  if ("error" in checked) return { ok: false, error: checked.error };
  const n = checked.name;
  if (!COLUMN_TYPES.includes(type)) return { ok: false, error: "Choose a valid type." };
  const db = getDb();
  const userId = getUserId();
  const track = db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, userId))).get();
  if (!track) return { ok: false, error: "Track not found." };
  const existing = db.select({ name: columns.name, position: columns.position }).from(columns).where(and(eq(columns.trackId, trackId), eq(columns.userId, userId))).all();
  if (existing.some((c) => c.name.toLowerCase() === n.toLowerCase())) return DUP;
  const position = existing.reduce((m, c) => Math.max(m, c.position + 1), 0);
  try {
    return { ok: true, id: db.insert(columns).values({ userId, trackId, name: n, type, position }).returning({ id: columns.id }).get().id };
  } catch (e) {
    if (isUniqueViolation(e)) return DUP;
    throw e;
  }
}

// The column's track siblings, only if the column is the current user's and belongs to that track.
function trackColumns(trackId: number, columnId: number) {
  const siblings = getDb()
    .select({ id: columns.id, name: columns.name, hidden: columns.hidden })
    .from(columns)
    .where(and(eq(columns.trackId, trackId), eq(columns.userId, getUserId())))
    .orderBy(asc(columns.position), asc(columns.id))
    .all();
  return siblings.some((c) => c.id === columnId) ? siblings : null;
}

const NOT_FOUND = { ok: false, error: "Column not found." } as const;

// Only the name changes: values hang off the column id (FR-2.4). Renaming to the same name in a different case is allowed.
export async function renameColumn(trackId: number, columnId: number, name: string): Promise<ColumnResult> {
  const checked = checkName(name);
  if ("error" in checked) return { ok: false, error: checked.error };
  const siblings = trackColumns(trackId, columnId);
  if (!siblings) return NOT_FOUND;
  const n = checked.name;
  if (siblings.some((c) => c.id !== columnId && c.name.toLowerCase() === n.toLowerCase())) return DUP;
  try {
    getDb().update(columns).set({ name: n }).where(and(eq(columns.id, columnId), eq(columns.userId, getUserId()))).run();
  } catch (e) {
    if (isUniqueViolation(e)) return DUP;
    throw e;
  }
  return { ok: true };
}

// Hiding keeps the column and its values (FR-2.3); showing it restores it at its old position.
export async function setColumnHidden(trackId: number, columnId: number, hidden: boolean): Promise<ColumnResult> {
  if (typeof hidden !== "boolean" || !trackColumns(trackId, columnId)) return NOT_FOUND;
  getDb().update(columns).set({ hidden }).where(and(eq(columns.id, columnId), eq(columns.userId, getUserId()))).run();
  return { ok: true };
}

// Swaps with the nearest *visible* neighbour in that direction, so one click always moves the column one step on screen;
// hidden columns keep their relative slot. At an edge it is a no-op (ok). Positions are then renumbered 0..n-1 in one
// transaction, so they stay unique and gap-free whatever state they were in.
export async function moveColumn(trackId: number, columnId: number, direction: "left" | "right"): Promise<ColumnResult> {
  if (direction !== "left" && direction !== "right") return NOT_FOUND;
  const all = trackColumns(trackId, columnId);
  if (!all) return NOT_FOUND;
  const from = all.findIndex((c) => c.id === columnId);
  const step = direction === "left" ? -1 : 1;
  let to = from + step;
  while (all[to]?.hidden) to += step;
  if (!all[to]) return { ok: true };
  const order = all.map((c) => c.id);
  [order[from], order[to]] = [order[to], order[from]];
  const userId = getUserId();
  getDb().transaction((tx) => {
    order.forEach((id, position) => tx.update(columns).set({ position }).where(and(eq(columns.id, id), eq(columns.userId, userId))).run());
  });
  return { ok: true };
}

export type ColumnDeleteImpact = { name: string; valueCount: number; archivedCount: number };

// What deleting would lose: stored cell rows of the column (a blank cell has no row), of which archived applications' are
// archivedCount (included in valueCount). Null if missing or not the current user's.
export async function getColumnDeleteImpact(columnId: number): Promise<ColumnDeleteImpact | null> {
  const db = getDb();
  const userId = getUserId();
  const col = db.select({ name: columns.name }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
  if (!col) return null;
  const rows = db
    .select({ archived: applications.archived, n: count() })
    .from(cellValues)
    .innerJoin(applications, eq(applications.id, cellValues.applicationId))
    .where(and(eq(cellValues.columnId, columnId), eq(cellValues.userId, userId)))
    .groupBy(applications.archived)
    .all();
  return { name: col.name, valueCount: rows.reduce((s, r) => s + r.n, 0), archivedCount: rows.find((r) => r.archived)?.n ?? 0 };
}

// Cell values and options go with the column via ON DELETE CASCADE. Positions are left as they are: the order is preserved,
// and addColumn/moveColumn already cope with a gap. The status column is refused (FR-3.1; 2.9 manages it).
// Callers must have confirmed with the user.
export async function deleteColumn(columnId: number): Promise<ColumnResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const col = tx.select({ isStatus: columns.isStatus }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
    if (!col) return NOT_FOUND;
    if (col.isStatus) return { ok: false, error: "The Status column cannot be deleted." } as const;
    tx.delete(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).run();
    return { ok: true } as const;
  });
}

// Moves the Status flag to this single-select column in one transaction. The old flag is cleared first because the partial unique
// index is checked per statement. Default values stay with their columns (the Status default is an ordinary column default).
// The new column needs an option, like the Status column's option delete rule. Already Status is a no-op (ok).
export async function setStatusColumn(trackId: number, columnId: number): Promise<ColumnResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const col = tx.select({ type: columns.type, trackId: columns.trackId, isStatus: columns.isStatus }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
    if (!col || col.trackId !== trackId) return NOT_FOUND;
    if (col.type !== "single_select") return { ok: false, error: "Only a single-select column can be the Status column." } as const;
    if (col.isStatus) return { ok: true } as const;
    const { n } = tx.select({ n: count() }).from(columnOptions).where(and(eq(columnOptions.columnId, columnId), eq(columnOptions.userId, userId))).get()!;
    if (n === 0) return { ok: false, error: "Add at least one option before using this column as Status." } as const;
    const updatedAt = new Date();
    tx.update(columns).set({ isStatus: false, updatedAt }).where(and(eq(columns.trackId, trackId), eq(columns.userId, userId), eq(columns.isStatus, true))).run();
    tx.update(columns).set({ isStatus: true, updatedAt }).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).run();
    return { ok: true } as const;
  });
}

// Sets (or, for blank/null, clears) the column's default value; it applies to applications created afterwards, never to existing rows
// (FR-2.1). One mechanism for every column type, the Status column included. Validated by parseCell for the column's type; a
// single_select default must be one of that column's own options. Stored via encodeDefault.
export async function setColumnDefault(columnId: number, raw: unknown): Promise<ColumnResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const col = tx.select({ type: columns.type }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
    if (!col) return NOT_FOUND;
    const parsed = parseCell(col.type, raw);
    if (!parsed.ok) return parsed;
    if (parsed.value !== null && col.type === "single_select") {
      const opt = tx.select({ id: columnOptions.id }).from(columnOptions).where(and(eq(columnOptions.id, parsed.value as number), eq(columnOptions.columnId, columnId), eq(columnOptions.userId, userId))).get();
      if (!opt) return { ok: false, error: "Choose one of this column's options." } as const;
    }
    tx.update(columns).set({ defaultValue: parsed.value === null ? null : encodeDefault(parsed.value), updatedAt: new Date() }).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).run();
    return { ok: true } as const;
  });
}
