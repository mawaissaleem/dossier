// Schema for tracks, columns, column_options, applications, cell_values, files, submissions, submission_files, notes, activity_events and settings. Stay on plain columns/FKs/indexes so v2 can move to Postgres (NFR-6).
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const COLUMN_TYPES = ["text", "number", "date", "link", "checkbox", "single_select"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

// Add a kind here and run db:generate: SQLite rebuilds the table to widen the CHECK, existing rows are copied unchanged.
export const ACTIVITY_KINDS = ["status_changed", "file_uploaded", "submission_created", "file_deleted"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const INTEGRITY_STATES = ["ok", "mismatch", "missing"] as const;
export type IntegrityState = (typeof INTEGRITY_STATES)[number];

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

// One row per stored file. relative_path is relative to the files root, forward slashes (FR-5.6); the file bytes are on disk.
// Deleting the application removes its rows (the bytes are removed by later phase 5 code, not by the database).
// base_name + extension + seq make the FR-6.2 counter: the next seq for (application, date, base name, extension) is one indexed query.
export const files = sqliteTable(
  "files",
  {
    ...base,
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // CV, cover letter, ...; the editable label list is separate (FR-5.3)
    originalName: text("original_name").notNull(),
    storedName: text("stored_name").notNull(),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(), // 64 lowercase hex
    sizeBytes: integer("size_bytes").notNull(),
    uploadDate: text("upload_date").notNull(), // YYYY-MM-DD, same encoding as cell_values.value_date
    baseName: text("base_name").notNull(),
    extension: text("extension").notNull(),
    seq: integer("seq").notNull(),
    // Result of the last hash check (8.6, FR-5.5); an upload is ok by definition. checked_at is null until a check re-reads the file.
    integrity: text("integrity", { enum: INTEGRITY_STATES }).notNull().default("ok"),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }),
    // Set when the file was deleted (8.8, FR-5.8). A file that no submission lists loses its row; a submitted one keeps it as a record (name, label,
    // size, hash) with the bytes gone. Every reader of live files must filter deleted_at IS NULL.
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("files_user_id_idx").on(t.userId),
    index("files_application_id_sha256_idx").on(t.applicationId, t.sha256), // FR-5.7 duplicate lookup
    uniqueIndex("files_user_id_relative_path_uniq").on(t.userId, t.relativePath),
    // Unique so two uploads racing for the same counter fail instead of overwriting each other's name.
    uniqueIndex("files_counter_uniq").on(t.applicationId, t.uploadDate, t.baseName, t.extension, t.seq),
    check("files_sha256_check", sql`length(${t.sha256}) = 64 AND ${t.sha256} NOT GLOB '*[^0-9a-f]*'`),
    check("files_size_bytes_check", sql`${t.sizeBytes} >= 0`),
    check("files_seq_check", sql`${t.seq} >= 1`),
  ],
);

// FR-7.8: nothing here is deleted by a status change; only deleting the application removes submissions.
export const submissions = sqliteTable(
  "submissions",
  {
    ...base,
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    note: text("note"),
  },
  (t) => [
    index("submissions_user_id_idx").on(t.userId),
    index("submissions_application_id_date_idx").on(t.applicationId, t.date),
  ],
);

// Many to many (FR-7.5). Deleting a submission removes its links. file_id is NO ACTION (the default, like cell_values.value_option_id):
// deleting the row of a file that is still in a submission fails, so deleting such a file (8.8, FR-5.8) only sets files.deleted_at and the
// submission keeps its record. Deleting the application works because the check runs at end of statement, after the cascades have
// removed its submissions and links.
export const submissionFiles = sqliteTable(
  "submission_files",
  {
    ...base,
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id),
  },
  (t) => [
    index("submission_files_user_id_idx").on(t.userId),
    uniqueIndex("submission_files_submission_id_file_id_uniq").on(t.submissionId, t.fileId),
    index("submission_files_file_id_idx").on(t.fileId),
  ],
);

// FR-11.1 free-text notes. The length limit is 7.2's validation; the database only refuses a blank body.
export const notes = sqliteTable(
  "notes",
  {
    ...base,
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
  },
  (t) => [
    index("notes_user_id_idx").on(t.userId),
    index("notes_application_id_created_at_idx").on(t.applicationId, t.createdAt),
    check("notes_body_check", sql`length(trim(${t.body}, ' ' || char(9, 10, 13))) > 0`),
  ],
);

// FR-11.2 automatic log. History must stay readable after what it mentions changes or is deleted, so `details` holds JSON text
// snapshots (e.g. status from/to ids and labels, file original/stored name and id, submission id/date/file count); the line is
// rendered from it alone. file_id/submission_id are optional links (ON DELETE SET NULL): deleting a file or submission never fails
// because of, and never erases, its event. Deleting the application cascades its events away (they are its history).
// occurred_at is when the thing happened (a manual submission can be backdated); created_at is when the row was written.
export const activityEvents = sqliteTable(
  "activity_events",
  {
    ...base,
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ACTIVITY_KINDS }).notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    details: text("details").notNull().default("{}"), // JSON; shape per kind is written and validated by 7.3
    fileId: integer("file_id").references(() => files.id, { onDelete: "set null" }),
    submissionId: integer("submission_id").references(() => submissions.id, { onDelete: "set null" }),
  },
  (t) => [
    index("activity_events_user_id_idx").on(t.userId),
    index("activity_events_application_id_occurred_at_idx").on(t.applicationId, t.occurredAt),
    index("activity_events_file_id_idx").on(t.fileId),
    index("activity_events_submission_id_idx").on(t.submissionId),
    check("activity_events_kind_check", sql`${t.kind} IN (${sql.join(ACTIVITY_KINDS.map((k) => sql.raw(`'${k}'`)), sql`, `)})`),
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
export type StoredFile = typeof files.$inferSelect; // not "File": that clashes with the DOM type
export type NewStoredFile = typeof files.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type SubmissionFile = typeof submissionFiles.$inferSelect;
export type NewSubmissionFile = typeof submissionFiles.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
