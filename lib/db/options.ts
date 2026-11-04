// Server-only. See lib/db/tracks.ts for the convention.
import { and, asc, count, eq } from "drizzle-orm";
import { isPaletteToken, nextColor } from "../colors";
import { checkOptionLabel, isSameIdSet, labelTaken } from "../options";
import { getDb } from "./client";
import { isForeignKeyViolation, isUniqueViolation } from "./errors";
import { applications, cellValues, columnOptions, columns } from "./schema";
import { getUserId } from "./user";

export type OptionResult = { ok: true } | { ok: false; error: string };
export type AddOptionResult = { ok: true; id: number } | { ok: false; error: string };

const DUP = { ok: false, error: "An option with that label already exists." } as const;
const NO_COLUMN = { ok: false, error: "Column not found." } as const;
const NO_OPTION = { ok: false, error: "Option not found." } as const;

// The column's options in position order, or an error result if the column is not the current user's single-select column.
function selectOptions(columnId: number) {
  const db = getDb();
  const userId = getUserId();
  const col = db.select({ type: columns.type }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
  if (!col) return NO_COLUMN;
  if (col.type !== "single_select") return { ok: false, error: "Only single-select columns have options." } as const;
  return db.select().from(columnOptions).where(and(eq(columnOptions.columnId, columnId), eq(columnOptions.userId, userId))).all();
}

// Appends at the end with the next unused palette colour. The unique index is case-sensitive, so the case-insensitive check is here;
// no await between the check and the insert and better-sqlite3 is sync, so nothing can interleave.
export async function addOption(columnId: number, label: string): Promise<AddOptionResult> {
  const checked = checkOptionLabel(label);
  if ("error" in checked) return { ok: false, error: checked.error };
  const existing = selectOptions(columnId);
  if (!Array.isArray(existing)) return existing;
  if (labelTaken(existing, checked.label)) return DUP;
  const position = existing.reduce((m, o) => Math.max(m, o.position + 1), 0);
  try {
    const id = getDb()
      .insert(columnOptions)
      .values({ userId: getUserId(), columnId, label: checked.label, color: nextColor(existing.map((o) => o.color)), position })
      .returning({ id: columnOptions.id })
      .get().id;
    return { ok: true, id };
  } catch (e) {
    if (isUniqueViolation(e)) return DUP;
    throw e;
  }
}

// Changes only this option row (label and/or colour). Cell values hold the option id, so every row follows (FR-3.3);
// bufferDays and position are untouched.
export async function updateOption(columnId: number, optionId: number, patch: { label?: string; color?: string }): Promise<OptionResult> {
  if (typeof patch !== "object" || patch === null) return { ok: false, error: "Nothing to change." };
  const set: { label?: string; color?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.label !== undefined) {
    const checked = checkOptionLabel(patch.label);
    if ("error" in checked) return { ok: false, error: checked.error };
    set.label = checked.label;
  }
  if (patch.color !== undefined) {
    if (!isPaletteToken(patch.color)) return { ok: false, error: "Choose a valid colour." };
    set.color = patch.color;
  }
  if (set.label === undefined && set.color === undefined) return { ok: false, error: "Nothing to change." };
  const existing = selectOptions(columnId);
  if (!Array.isArray(existing)) return existing;
  if (!existing.some((o) => o.id === optionId)) return NO_OPTION;
  if (set.label !== undefined && labelTaken(existing, set.label, optionId)) return DUP;
  try {
    getDb().update(columnOptions).set(set).where(and(eq(columnOptions.id, optionId), eq(columnOptions.columnId, columnId), eq(columnOptions.userId, getUserId()))).run();
  } catch (e) {
    if (isUniqueViolation(e)) return DUP;
    throw e;
  }
  return { ok: true };
}

// Rewrites positions 0..n-1 in the given order in one transaction. The list must be exactly the column's current option ids,
// otherwise nothing changes. Selected inside the transaction so the check and the writes see the same state.
export async function reorderOptions(columnId: number, orderedIds: number[]): Promise<OptionResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const existing = selectOptions(columnId);
    if (!Array.isArray(existing)) return existing;
    if (!isSameIdSet(existing.map((o) => o.id), orderedIds)) return { ok: false, error: "The options changed. The list now shows the current order; try again." } as const;
    const updatedAt = new Date();
    orderedIds.forEach((id, position) =>
      tx.update(columnOptions).set({ position, updatedAt }).where(and(eq(columnOptions.id, id), eq(columnOptions.columnId, columnId), eq(columnOptions.userId, userId))).run(),
    );
    return { ok: true } as const;
  });
}

export type OptionDeleteImpact = { label: string; useCount: number; archivedCount: number };

// How many applications hold this option in its column (archived included, reported separately in archivedCount).
// Null if the option is missing or not the current user's.
export async function getOptionDeleteImpact(optionId: number): Promise<OptionDeleteImpact | null> {
  const db = getDb();
  const userId = getUserId();
  const opt = db.select({ label: columnOptions.label }).from(columnOptions).where(and(eq(columnOptions.id, optionId), eq(columnOptions.userId, userId))).get();
  if (!opt) return null;
  const rows = db
    .select({ archived: applications.archived, n: count() })
    .from(cellValues)
    .innerJoin(applications, eq(applications.id, cellValues.applicationId))
    .where(and(eq(cellValues.valueOptionId, optionId), eq(cellValues.userId, userId)))
    .groupBy(applications.archived)
    .all();
  return { label: opt.label, useCount: rows.reduce((s, r) => s + r.n, 0), archivedCount: rows.find((r) => r.archived)?.n ?? 0 };
}

// One transaction: move this option's cell values to `reassignTo` (another option of the same column) or, for null, delete those
// cell rows (blank = missing row); repoint or clear the column default if it was this option; delete the option; close the position gap.
// The last option of the Status column is refused so the status default cannot dangle. Callers must have confirmed with the user.
export async function deleteOption(optionId: number, reassignTo: number | null): Promise<OptionResult> {
  const userId = getUserId();
  try {
    return getDb().transaction((tx) => {
      const opt = tx.select({ columnId: columnOptions.columnId }).from(columnOptions).where(and(eq(columnOptions.id, optionId), eq(columnOptions.userId, userId))).get();
      if (!opt) return NO_OPTION;
      const col = tx.select({ isStatus: columns.isStatus, defaultValue: columns.defaultValue }).from(columns).where(and(eq(columns.id, opt.columnId), eq(columns.userId, userId))).get();
      if (!col) return NO_COLUMN;
      const siblings = tx.select({ id: columnOptions.id }).from(columnOptions).where(and(eq(columnOptions.columnId, opt.columnId), eq(columnOptions.userId, userId))).orderBy(asc(columnOptions.position), asc(columnOptions.id)).all().map((o) => o.id);
      if (col.isStatus && siblings.length === 1) return { ok: false, error: "The Status column needs at least one option." } as const;
      if (reassignTo !== null && (reassignTo === optionId || !siblings.includes(reassignTo))) return { ok: false, error: "Choose another option of this column to reassign to." } as const;
      const holding = and(eq(cellValues.columnId, opt.columnId), eq(cellValues.valueOptionId, optionId), eq(cellValues.userId, userId));
      if (reassignTo === null) tx.delete(cellValues).where(holding).run();
      else tx.update(cellValues).set({ valueOptionId: reassignTo, updatedAt: new Date() }).where(holding).run();
      if (col.defaultValue === String(optionId)) {
        tx.update(columns).set({ defaultValue: reassignTo === null ? null : String(reassignTo), updatedAt: new Date() }).where(and(eq(columns.id, opt.columnId), eq(columns.userId, userId))).run();
      }
      tx.delete(columnOptions).where(and(eq(columnOptions.id, optionId), eq(columnOptions.userId, userId))).run();
      siblings.filter((id) => id !== optionId).forEach((id, position) =>
        tx.update(columnOptions).set({ position }).where(and(eq(columnOptions.id, id), eq(columnOptions.userId, userId))).run(),
      );
      return { ok: true } as const;
    });
  } catch (e) {
    // Counts and checks above should make this unreachable; the FK is the safety net if a cell row still points here.
    if (isForeignKeyViolation(e)) return { ok: false, error: "Applications still use this option. Reassign them or leave them blank first." };
    throw e;
  }
}
