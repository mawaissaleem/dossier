// Server-only. See lib/db/tracks.ts for the convention.
import { and, eq } from "drizzle-orm";
import { CELL_FIELD, parseCell, readCell, type CellScalar } from "../cells";
import { getDb } from "./client";
import { applications, cellValues, columnOptions, columns, type ColumnType } from "./schema";
import { getUserId } from "./user";

// True if the option exists on that column for this user. The one rule behind "a single_select value must be one of its column's options".
export function optionBelongs(db: Pick<ReturnType<typeof getDb>, "select">, userId: string, columnId: number, optionId: number): boolean {
  return !!db.select({ id: columnOptions.id }).from(columnOptions)
    .where(and(eq(columnOptions.id, optionId), eq(columnOptions.columnId, columnId), eq(columnOptions.userId, userId))).get();
}

export type SetCellResult = { ok: true; value: CellScalar | null } | { ok: false; error: string };

// Validates, then upserts one typed field (others null). Blank deletes the row: a missing row means blank.
// No await between the checks and the write, and better-sqlite3 is sync, so nothing can interleave.
export async function setCellValue(applicationId: number, columnId: number, raw: unknown): Promise<SetCellResult> {
  const db = getDb();
  const userId = getUserId();
  const app = db.select({ trackId: applications.trackId }).from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get();
  if (!app) return { ok: false, error: "Application not found." };
  const col = db.select({ type: columns.type, trackId: columns.trackId }).from(columns)
    .where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
  if (!col || col.trackId !== app.trackId) return { ok: false, error: "Column not found." };

  const parsed = parseCell(col.type, raw);
  if (!parsed.ok) return parsed;
  if (parsed.value !== null && col.type === "single_select" && !optionBelongs(db, userId, columnId, parsed.value as number)) return { ok: false, error: "Choose a valid option." };
  writeCell(db, userId, applicationId, columnId, col.type, parsed.value);
  return parsed;
}

// Writes an already validated value: null deletes the row (blank), anything else upserts the one typed field (others null).
// Shared by setCellValue and updateApplication, so inline and form edits store cells the same way. Callers check ownership and the option.
export function writeCell(db: Pick<ReturnType<typeof getDb>, "insert" | "delete">, userId: string, applicationId: number, columnId: number, type: ColumnType, value: CellScalar | null) {
  if (value === null) {
    db.delete(cellValues).where(and(eq(cellValues.applicationId, applicationId), eq(cellValues.columnId, columnId))).run();
    return;
  }
  const fields = { valueText: null, valueNumber: null, valueDate: null, valueBool: null, valueOptionId: null, [CELL_FIELD[type]]: value };
  db.insert(cellValues).values({ userId, applicationId, columnId, ...fields })
    .onConflictDoUpdate({ target: [cellValues.applicationId, cellValues.columnId], set: { ...fields, updatedAt: new Date() } }).run();
}

// Typed value, or null if blank or if the application/column is not the current user's.
export async function getCellValue(applicationId: number, columnId: number): Promise<CellScalar | null> {
  const db = getDb();
  const userId = getUserId();
  const row = db.select({ type: columns.type, cell: cellValues }).from(cellValues)
    .innerJoin(columns, eq(columns.id, cellValues.columnId))
    .where(and(eq(cellValues.applicationId, applicationId), eq(cellValues.columnId, columnId), eq(cellValues.userId, userId)))
    .get();
  return row ? readCell(row.type, row.cell) : null;
}
