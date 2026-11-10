// Server-only. See lib/db/tracks.ts for the convention.
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { CELL_FIELD, decodeDefault, parseCell, readCell, type CellScalar } from "../cells";
import { NEEDS_REVIEW_ERROR } from "../submission-review";
import { insertStatusEvent } from "./activity";
import { optionBelongs, writeCell } from "./cells";
import { statusNeedsReview } from "./status-review";
import { getDb } from "./client";
import { listColumns, type ColumnItem } from "./columns";
import { applications, cellValues, columnOptions, columns, files, notes, submissions, tracks, type ColumnType } from "./schema";
import { getUserId } from "./user";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

// Cell rows a new application starts with: every track column's default (FR-1.6), Status included (one mechanism, see decodeDefault).
// A default is used only if it decodes for the column's type and, for a single_select, names an option that still belongs to that
// column; anything else (hand-edited, deleted or foreign option) is skipped, so the application is created with a blank cell.
function defaultCells(tx: Tx, trackId: number, userId: string) {
  const cols = tx.select({ id: columns.id, type: columns.type, defaultValue: columns.defaultValue }).from(columns)
    .where(and(eq(columns.trackId, trackId), eq(columns.userId, userId), isNotNull(columns.defaultValue))).all();
  const cells: { columnId: number }[] = []; // plus the one typed value field of the column's type
  for (const c of cols) {
    const value = decodeDefault(c.type, c.defaultValue);
    if (value === null) continue;
    if (c.type === "single_select" && !tx.select({ id: columnOptions.id }).from(columnOptions)
      .where(and(eq(columnOptions.id, value as number), eq(columnOptions.columnId, c.id), eq(columnOptions.userId, userId))).get()) continue;
    cells.push({ columnId: c.id, [CELL_FIELD[c.type]]: value });
  }
  return cells;
}

export type NewCell = { columnId: number; value: unknown };
export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

// The one per-value check for create and update. Every value is validated before anything is written. Errors name the column.
// A column that is missing, in another track or another user's is "A column was removed or changed" (it can be deleted while the form is open).
// Result: columnId -> typed value, null = blank (no row). Insertion order = submitted order.
function validateValues(tx: Tx, userId: string, trackId: number, values: NewCell[]) {
  const cols = new Map(tx.select({ id: columns.id, name: columns.name, type: columns.type, isStatus: columns.isStatus }).from(columns)
    .where(and(eq(columns.trackId, trackId), eq(columns.userId, userId))).all().map((c) => [c.id, c]));
  const submitted = new Map<number, { type: ColumnType; value: CellScalar | null; isStatus: boolean }>();
  for (const { columnId, value } of values) {
    const col = cols.get(columnId);
    if (!col) return { ok: false as const, error: "A column was removed or changed. Reload the page and try again." };
    if (submitted.has(columnId)) return { ok: false as const, error: `${col.name}: given twice.` };
    const parsed = parseCell(col.type, value);
    if (!parsed.ok) return { ok: false as const, error: `${col.name}: ${parsed.error}` };
    if (parsed.value !== null && col.type === "single_select" && !optionBelongs(tx, userId, columnId, parsed.value as number))
      return { ok: false as const, error: `${col.name}: Choose a valid option.` };
    submitted.set(columnId, { type: col.type, value: parsed.value, isStatus: col.isStatus });
  }
  return { ok: true as const, submitted };
}

// `values` are the submitted cells. A column listed there (even blank, value null) is the user's choice and gets no default;
// a column not listed gets its default (FR-1.6). Every value is validated before anything is inserted, and the application,
// submitted cells and defaults go in one transaction, so a bad value creates nothing and the application is never half filled.
// A new application may start in a submitted status (default or chosen): it has no files yet, so there is nothing to review and no
// submission is created (the submission review, FR-7.2, only guards moving an existing application). Add the submission later (6.6).
export async function createApplication({ title, trackId, values = [] }: { title: string; trackId: number; values?: NewCell[] }): Promise<CreateResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const track = tx.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, userId))).get();
    if (!track) return { ok: false, error: "Track not found." };
    const v = validateValues(tx, userId, trackId, values);
    if (!v.ok) return v;
    const id = tx.insert(applications).values({ userId, trackId, title }).returning({ id: applications.id }).get().id;
    const cells = [
      ...[...v.submitted].filter(([, c]) => c.value !== null).map(([columnId, c]) => ({ columnId, [CELL_FIELD[c.type]]: c.value })),
      ...defaultCells(tx, trackId, userId).filter((c) => !v.submitted.has(c.columnId)),
    ];
    // Initial status: one event "from blank to X" (the application starts with a status, which is a change from nothing).
    const statusCol = tx.select({ id: columns.id }).from(columns).where(and(eq(columns.trackId, trackId), eq(columns.userId, userId), eq(columns.isStatus, true))).get();
    const initial = cells.find((c) => c.columnId === statusCol?.id) as { valueOptionId?: number } | undefined;
    if (statusCol && initial?.valueOptionId) {
      const o = tx.select({ id: columnOptions.id, label: columnOptions.label }).from(columnOptions).where(eq(columnOptions.id, initial.valueOptionId)).get();
      if (o) insertStatusEvent(tx, userId, id, statusCol.id, null, o);
    }
    if (cells.length) tx.insert(cellValues).values(cells.map((c) => ({ userId, applicationId: id, ...c }))).run();
    return { ok: true, id };
  });
}

// needsReview: the save would move a submission-less application to a submitted status. Nothing is saved (not even the title or other
// cells); the caller runs the submission review (confirmSubmittedStatus) and saves the rest after it. Same rule as setCellValue.
export type UpdateResult = { ok: true } | { ok: false; error: string; needsReview?: true };

// Edit form save: sets the title and writes only the listed cells (the form sends just the fields the user changed), in one transaction.
// Same validation as create; a blank value deletes the cell row; no defaults. A bad value changes nothing. Works on archived
// applications and leaves them archived. "Application not found." if missing or not the current user's.
export async function updateApplication({ id, title, values = [] }: { id: number; title: string; values?: NewCell[] }): Promise<UpdateResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const app = tx.select({ trackId: applications.trackId }).from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).get();
    if (!app) return { ok: false, error: "Application not found." };
    const v = validateValues(tx, userId, app.trackId, values);
    if (!v.ok) return v;
    for (const [columnId, c] of v.submitted) {
      if (statusNeedsReview(tx, userId, { applicationId: id, trackId: app.trackId, column: { id: columnId, isStatus: c.isStatus }, optionId: c.value as number | null })) {
        return { ok: false, error: NEEDS_REVIEW_ERROR, needsReview: true };
      }
    }
    tx.update(applications).set({ title }).where(eq(applications.id, id)).run();
    for (const [columnId, c] of v.submitted) writeCell(tx, userId, id, columnId, c.type, c.value);
    return { ok: true };
  });
}

export type ApplicationListItem = { id: number; title: string };

// Non-archived applications of the current user's track, newest first (id breaks ties).
export async function listApplications(trackId: number): Promise<ApplicationListItem[]> {
  return getDb()
    .select({ id: applications.id, title: applications.title })
    .from(applications)
    .where(and(eq(applications.trackId, trackId), eq(applications.userId, getUserId()), eq(applications.archived, false)))
    .orderBy(desc(applications.id))
    .all();
}

export type ApplicationRow = { id: number; title: string; values: Record<number, CellScalar | null> };

// Same rows and order as listApplications, each with every column of the track as a key (null = blank, FR-2.1).
// Fixed 4 queries (columns, options, applications, cell values), pivoted in JS: one pass over the cell rows into a
// per-application map is simpler than a SQL pivot, which would need a dynamic CASE per column.
// Pass `cols` (from listColumns) to reuse an already-loaded column list instead of querying it again.
export async function listApplicationRows(trackId: number, cols?: ColumnItem[]): Promise<ApplicationRow[]> {
  const db = getDb();
  const userId = getUserId();
  cols ??= await listColumns(trackId);
  const apps = await listApplications(trackId);
  if (apps.length === 0) return [];
  const type = new Map(cols.map((c) => [c.id, c.type]));
  const byApp = new Map<number, Record<number, CellScalar | null>>(
    apps.map((a) => [a.id, Object.fromEntries(cols.map((c) => [c.id, null]))]),
  );
  const cells = db
    .select({ cell: cellValues })
    .from(cellValues)
    .innerJoin(applications, eq(applications.id, cellValues.applicationId))
    .where(and(eq(applications.trackId, trackId), eq(applications.archived, false), eq(applications.userId, userId), eq(cellValues.userId, userId)))
    .all();
  for (const { cell } of cells) {
    const t = type.get(cell.columnId);
    const vals = byApp.get(cell.applicationId); // undefined if the app was (un)archived between the two reads
    if (t && vals) vals[cell.columnId] = readCell(t, cell); // skips cells of columns outside this track
  }
  return apps.map((a) => ({ ...a, values: byApp.get(a.id)! }));
}

export type ApplicationDetail = {
  id: number;
  title: string;
  archived: boolean;
  track: { id: number; name: string };
  columns: ColumnItem[]; // all of the track's columns in position order, hidden included
  values: Record<number, CellScalar | null>; // every column id is a key (null = blank)
};

// Null if missing or not the current user's. Archived applications are returned (direct URL still works).
// Fixed 4 queries: application + track (one join), columns, options, cell values.
export async function getApplicationDetail(id: number): Promise<ApplicationDetail | null> {
  const db = getDb();
  const userId = getUserId();
  const row = db
    .select({ id: applications.id, title: applications.title, archived: applications.archived, trackId: tracks.id, trackName: tracks.name })
    .from(applications)
    .innerJoin(tracks, and(eq(tracks.id, applications.trackId), eq(tracks.userId, userId)))
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .get();
  if (!row) return null;
  const cols = await listColumns(row.trackId);
  const type = new Map(cols.map((c) => [c.id, c.type]));
  const values: Record<number, CellScalar | null> = Object.fromEntries(cols.map((c) => [c.id, null]));
  const cells = db.select().from(cellValues).where(and(eq(cellValues.applicationId, id), eq(cellValues.userId, userId))).all();
  for (const cell of cells) {
    const t = type.get(cell.columnId);
    if (t) values[cell.columnId] = readCell(t, cell);
  }
  return { id: row.id, title: row.title, archived: row.archived, track: { id: row.trackId, name: row.trackName }, columns: cols, values };
}

// True if the current user's application exists (also when the flag already had that value). Reversible, so no confirmation.
export async function archiveApplication(id: number, archived: boolean): Promise<boolean> {
  return getDb().update(applications).set({ archived }).where(and(eq(applications.id, id), eq(applications.userId, getUserId()))).run().changes > 0;
}

// Stored file rows of the application, so the delete confirmation states the real number (NFR-4).
async function countApplicationFiles(applicationId: number): Promise<number> {
  const { n } = getDb().select({ n: count() }).from(files).where(and(eq(files.applicationId, applicationId), eq(files.userId, getUserId()))).get()!;
  return n;
}

// Notes of the application are the user's own text and go with it, so the confirmation states the number (NFR-4).
// Activity events are not counted: they are automatic history of the application and go with it.
async function countApplicationNotes(applicationId: number): Promise<number> {
  const { n } = getDb().select({ n: count() }).from(notes).where(and(eq(notes.applicationId, applicationId), eq(notes.userId, getUserId()))).get()!;
  return n;
}

// Submissions of the application: deleting it removes them and their file links, so the confirmation states the number (NFR-4).
async function countApplicationSubmissions(applicationId: number): Promise<number> {
  const { n } = getDb().select({ n: count() }).from(submissions).where(and(eq(submissions.applicationId, applicationId), eq(submissions.userId, getUserId()))).get()!;
  return n;
}

export type DeleteImpact = { title: string; cellCount: number; fileCount: number; submissionCount: number; noteCount: number };

// What deleting would lose: stored cell values (a blank cell has no row, FR-1.4), files, submissions and notes. Null if missing or not the current user's.
export async function getDeleteImpact(id: number): Promise<DeleteImpact | null> {
  const db = getDb();
  const userId = getUserId();
  const app = db.select({ title: applications.title }).from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).get();
  if (!app) return null;
  const { n } = db.select({ n: count() }).from(cellValues).where(and(eq(cellValues.applicationId, id), eq(cellValues.userId, userId))).get()!;
  return { title: app.title, cellCount: n, fileCount: await countApplicationFiles(id), submissionCount: await countApplicationSubmissions(id), noteCount: await countApplicationNotes(id) };
}

export type DeleteResult = { ok: true; trackId: number } | { ok: false; error: string };
const NO_APP = { ok: false, error: "Application not found." } as const;

// Returns the application's track id (for the redirect). Cell values, file rows, submissions, notes and activity events go with it via ON DELETE CASCADE (foreign_keys is on, see client.ts).
// Callers must have confirmed with the user, and `expected` is the impact they were shown: if a count changed since, nothing is deleted (NFR-4).
export async function deleteApplication(id: number, expected: { cellCount: number; fileCount: number; submissionCount: number; noteCount: number }): Promise<DeleteResult> {
  const userId = getUserId();
  const stale = { ok: false, error: "This application changed since the count was shown. Check again." } as const;
  return getDb().transaction((tx) => {
    const owned = and(eq(applications.id, id), eq(applications.userId, userId));
    if (!tx.select({ id: applications.id }).from(applications).where(owned).get()) return NO_APP;
    const { n } = tx.select({ n: count() }).from(cellValues).where(and(eq(cellValues.applicationId, id), eq(cellValues.userId, userId))).get()!;
    if (n !== expected.cellCount) return stale;
    // Files can be uploaded at any moment (5.7), so the count is checked here, in the same transaction as the delete.
    const f = tx.select({ n: count() }).from(files).where(and(eq(files.applicationId, id), eq(files.userId, userId))).get()!;
    if (f.n !== expected.fileCount) return stale;
    const s = tx.select({ n: count() }).from(submissions).where(and(eq(submissions.applicationId, id), eq(submissions.userId, userId))).get()!;
    if (s.n !== expected.submissionCount) return stale;
    const nt = tx.select({ n: count() }).from(notes).where(and(eq(notes.applicationId, id), eq(notes.userId, userId))).get()!;
    if (nt.n !== expected.noteCount) return stale;
    const { trackId } = tx.delete(applications).where(owned).returning({ trackId: applications.trackId }).get()!;
    return { ok: true, trackId } as const;
  });
}
