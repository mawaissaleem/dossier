// Schema for tracks, columns, column_options, applications, cell_values and settings. Stay on plain columns/FKs/indexes so v2 can move to Postgres (NFR-6).
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const COLUMN_TYPES = ["text", "number", "date", "link", "checkbox", "single_select"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

// Shared by every table ( every table has user_id and timestamps).
const base = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

export const tracks = sqliteTable(
  "tracks",
  {
    ...base,
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("tracks_user_id_position_idx").on(t.userId, t.position)],
);

// A track's default status is its status column's default_value; track settings live in the settings table.
export const columns = sqliteTable(
  "columns",
  {
    ...base,
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: COLUMN_TYPES }).notNull(),
    position: integer("position").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    isStatus: integer("is_status", { mode: "boolean" }).notNull().default(false),
    // Raw default as text; for single_select it is the option id as a string.
    defaultValue: text("default_value"),
  },
  (t) => [
    index("columns_user_id_idx").on(t.userId),
    index("columns_track_id_position_idx").on(t.trackId, t.position),
    uniqueIndex("columns_track_id_name_uniq").on(t.trackId, t.name),
    uniqueIndex("columns_one_status_per_track_uniq").on(t.trackId).where(sql`${t.isStatus} = 1`),
  ],
);

// Rows reference options by id, never by label, so rename/recolour keeps values (FR-3.3).
export const columnOptions = sqliteTable(
  "column_options",
  {
    ...base,
    columnId: integer("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    color: text("color").notNull(),
    position: integer("position").notNull(),
    bufferDays: integer("buffer_days"),
  },
  (t) => [
    index("column_options_user_id_idx").on(t.userId),
    index("column_options_column_id_position_idx").on(t.columnId, t.position),
    uniqueIndex("column_options_column_id_label_uniq").on(t.columnId, t.label),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    ...base,
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("applications_user_id_idx").on(t.userId),
    index("applications_track_id_archived_idx").on(t.trackId, t.archived),
  ],
);

// One typed row per application per column; a missing row means blank (FR-1.4 / FR-2.1).
export const cellValues = sqliteTable(
  "cell_values",
  {
    ...base,
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    columnId: integer("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    valueText: text("value_text"), // text and link
    valueNumber: real("value_number"),
    valueDate: text("value_date"), // YYYY-MM-DD, no time zone; sorts as text, maps to Postgres date
    valueBool: integer("value_bool", { mode: "boolean" }),
    // Default NO ACTION (not cascade/set null): deleting an in-use option fails until the app reassigns it (FR-3.4).
    // Deleting the whole column still works because the check runs at end of statement, after the cascades.
    valueOptionId: integer("value_option_id").references(() => columnOptions.id),
  },
  (t) => [
    uniqueIndex("cell_values_application_id_column_id_uniq").on(t.applicationId, t.columnId),
    index("cell_values_column_id_value_text_idx").on(t.columnId, t.valueText),
    index("cell_values_column_id_value_number_idx").on(t.columnId, t.valueNumber),
    index("cell_values_column_id_value_date_idx").on(t.columnId, t.valueDate),
    index("cell_values_column_id_value_option_id_idx").on(t.columnId, t.valueOptionId),
  ],
);

// value is JSON-encoded text.
export const settings = sqliteTable(
  "settings",
  {
    ...base,
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [uniqueIndex("settings_user_id_key_uniq").on(t.userId, t.key)],
);

export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type Column = typeof columns.$inferSelect;
export type NewColumn = typeof columns.$inferInsert;
export type ColumnOption = typeof columnOptions.$inferSelect;
export type NewColumnOption = typeof columnOptions.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type CellValue = typeof cellValues.$inferSelect;
export type NewCellValue = typeof cellValues.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
