// Pure: friendly labels for column types. Type-only import so client code never pulls in the schema module.
// Record<ColumnType, ...> makes adding a type to COLUMN_TYPES a compile error until it is labelled here.
import type { ColumnType } from "./db/schema";

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  link: "Link",
  checkbox: "Checkbox",
  single_select: "Single select",
};

// Dropdown order follows the declaration above (string keys keep insertion order).
export const columnTypeOptions = (Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((type) => ({ type, label: COLUMN_TYPE_LABELS[type] }));
