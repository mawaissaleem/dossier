// The one Priority-column rule, shared by the add form's essentials, the quick-filter chips and the fake-data seeder. Pure: no imports beyond types.
import type { ColumnType } from "./db/schema";

export const isPriority = (c: { name: string; type: ColumnType }) => c.type === "single_select" && c.name.trim().toLowerCase() === "priority";
