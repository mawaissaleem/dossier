// The one Priority-column rule, shared by the add form's essentials, the quick-filter chips, the board card and the fake-data seeder.
// isDeadline is the same kind of rule for the Deadline column (add form essentials and board card). Pure: no imports beyond types.
import type { ColumnType } from "./db/schema";

export const isPriority = (c: { name: string; type: ColumnType }) => c.type === "single_select" && c.name.trim().toLowerCase() === "priority";
export const isDeadline = (c: { name: string; type: ColumnType }) => c.type === "date" && c.name.trim().toLowerCase() === "deadline";
