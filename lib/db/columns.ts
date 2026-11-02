// Server-only. See lib/db/tracks.ts for the convention.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ColumnType } from "./schema";
import { getDb } from "./client";
import { columnOptions, columns } from "./schema";
import { getUserId } from "./user";

export type OptionItem = { id: number; label: string; color: string; position: number };
export type ColumnItem = {
  id: number;
  name: string;
  type: ColumnType;
  hidden: boolean;
  isStatus: boolean;
  options: OptionItem[]; // empty unless single_select
};

// Columns of the current user's track in display order (position, then id), hidden ones included with the flag.
// Two queries however many columns: columns, then all their options at once.
export async function listColumns(trackId: number): Promise<ColumnItem[]> {
  const db = getDb();
  const userId = getUserId();
  const cols = db
    .select({ id: columns.id, name: columns.name, type: columns.type, hidden: columns.hidden, isStatus: columns.isStatus })
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
