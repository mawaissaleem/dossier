// Server-only. See lib/db/tracks.ts for the convention.
import { and, eq } from "drizzle-orm";
import { CELL_FIELD, parseCell, readCell, type CellScalar } from "../cells";
import { getDb } from "./client";
import { applications, cellValues, columnOptions, columns } from "./schema";
import { getUserId } from "./user";

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
  const where = and(eq(cellValues.applicationId, applicationId), eq(cellValues.columnId, columnId));
  if (parsed.value === null) {
    db.delete(cellValues).where(where).run();
    return parsed;
  }
  if (col.type === "single_select") {
    const opt = db.select({ id: columnOptions.id }).from(columnOptions)
      .where(and(eq(columnOptions.id, parsed.value as number), eq(columnOptions.columnId, columnId), eq(columnOptions.userId, userId))).get();
    if (!opt) return { ok: false, error: "Choose a valid option." };
  }
  const fields = { valueText: null, valueNumber: null, valueDate: null, valueBool: null, valueOptionId: null, [CELL_FIELD[col.type]]: parsed.value };
  db.insert(cellValues).values({ userId, applicationId, columnId, ...fields })
    .onConflictDoUpdate({ target: [cellValues.applicationId, cellValues.columnId], set: { ...fields, updatedAt: new Date() } }).run();
  return parsed;
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
