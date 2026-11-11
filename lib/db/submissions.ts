// Server-only. See lib/db/tracks.ts for the convention. Submissions (FR-7): a dated, noted set of an application's files.
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { submissionOccurredAt } from "../activity";
import { isValidDate } from "../filename";
import { insertEvent } from "./activity";
import { getDb } from "./client";
import { optionBelongs, writeCell } from "./cells";
import { applications, columns, files, submissionFiles, submissions, type IntegrityState } from "./schema";
import { submittedStatusIds } from "./track-settings";
import { getUserId } from "./user";

export const NOTE_MAX = 2000;

export type CreateSubmissionResult = { ok: true; id: number } | { ok: false; error: string };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

// Everything is checked and written in one transaction: a refusal writes nothing. Zero files is allowed here (6.5 warns, FR-7.3).
// Every file must belong to this application and user: the DB only checks that the file exists (see schema.ts).
export async function createSubmission(applicationId: number, fileIds: number[], date: string, note: string | null | undefined): Promise<CreateSubmissionResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => insertSubmission(tx, userId, applicationId, fileIds, date, note));
}

// The checks and inserts of createSubmission, inside the caller's transaction. A refusal returns before writing anything.
function insertSubmission(tx: Tx, userId: string, applicationId: number, fileIds: number[], date: string, note: string | null | undefined): CreateSubmissionResult {
  if (typeof date !== "string" || !isValidDate(date)) return { ok: false, error: "Use a real date as YYYY-MM-DD." };
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > NOTE_MAX) return { ok: false, error: `The note can be at most ${NOTE_MAX} characters.` };
  const ids = [...new Set(fileIds)];
  if (!tx.select({ id: applications.id }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get()) {
    return { ok: false, error: "Application not found." };
  }
  let names: string[] = [];
  if (ids.length) {
    const own = tx.select({ id: files.id, storedName: files.storedName }).from(files)
      .where(and(inArray(files.id, ids), eq(files.applicationId, applicationId), eq(files.userId, userId))).all();
    if (own.length !== ids.length) return { ok: false, error: "A file does not belong to this application. Reload the page and try again." };
    names = ids.map((id) => own.find((f) => f.id === id)!.storedName);
  }
  const id = tx.insert(submissions).values({ userId, applicationId, date, note: trimmed || null }).returning({ id: submissions.id }).get().id;
  if (ids.length) tx.insert(submissionFiles).values(ids.map((fileId) => ({ userId, submissionId: id, fileId }))).run();
  // The event sorts by the submission date (a backdated one lands in its place in the history); the details keep the file names as of now.
  insertEvent(tx, userId, applicationId, submissionOccurredAt(date, new Date()), { kind: "submission_created", submissionId: id, date, fileCount: names.length, fileNames: names }, { submissionId: id });
  return { ok: true, id };
}

// FR-7.6: the note is the only field of a submission that can change. There is deliberately no function to change its date or files, or to delete
// a submission (not in the SRS): a mistake is corrected by adding a new submission. Same note rules as creation; blank clears the note.
export async function updateSubmissionNote(id: number, note: string | null | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > NOTE_MAX) return { ok: false, error: `The note can be at most ${NOTE_MAX} characters.` };
  const r = getDb().update(submissions).set({ note: trimmed || null }).where(and(eq(submissions.id, id), eq(submissions.userId, getUserId()))).run();
  return r.changes ? { ok: true } : { ok: false, error: "Submission not found." };
}

// Null if the column is the status column of the application's track and the option is one of its options, else the message to show.
function statusChoiceError(tx: Tx, userId: string, trackId: number, columnId: number, optionId: number): string | null {
  const col = tx.select({ trackId: columns.trackId, isStatus: columns.isStatus }).from(columns).where(and(eq(columns.id, columnId), eq(columns.userId, userId))).get();
  if (!col || col.trackId !== trackId || !col.isStatus) return "Status column not found. Reload the page and try again.";
  if (!optionBelongs(tx, userId, columnId, optionId)) return "That status no longer exists. Reload the page and try again.";
  return null;
}

// The confirm step of the submission review (FR-7.2): sets the application's status cell and creates its FIRST submission in one
// transaction, both or neither. Refuses (nothing written) when the column is not the application's status column, the option is not a
// submitted status of the track, a submission already exists (reload: the review no longer applies; further ones are manual, 6.6),
// or the submission itself is invalid (bad date, note, foreign file).
export async function submitWithStatus(applicationId: number, columnId: number, optionId: number, fileIds: number[], date: string, note: string | null | undefined): Promise<CreateSubmissionResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const app = tx.select({ trackId: applications.trackId }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get();
    if (!app) return { ok: false, error: "Application not found." };
    const bad = statusChoiceError(tx, userId, app.trackId, columnId, optionId);
    if (bad) return { ok: false, error: bad };
    if (!submittedStatusIds(app.trackId).includes(optionId)) return { ok: false, error: "That status no longer counts as submitted. Reload the page and try again." };
    const { n } = tx.select({ n: count() }).from(submissions).where(and(eq(submissions.applicationId, applicationId), eq(submissions.userId, userId))).get()!;
    if (n > 0) return { ok: false, error: "This application already has a submission. Reload the page and try again." };
    const r = insertSubmission(tx, userId, applicationId, fileIds, date, note);
    if (r.ok) writeCell(tx, userId, applicationId, columnId, "single_select", optionId);
    return r;
  });
}

// A further submission made by hand (FR-7.4): at least one file, any date and note, and optionally a status change saved in the same
// transaction (both or neither). It works with or without earlier submissions; the status is written directly, so the review (FR-7.2)
// is never asked for: this submission is the record. A refusal writes nothing. Archived applications are allowed on purpose: a reply or
// an extra document can come after archiving.
export async function createManualSubmission(
  applicationId: number, fileIds: number[], date: string, note: string | null | undefined, status: { columnId: number; optionId: number } | null,
): Promise<CreateSubmissionResult> {
  if (fileIds.length === 0) return { ok: false, error: "Choose at least one file." };
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const app = tx.select({ trackId: applications.trackId }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get();
    if (!app) return { ok: false, error: "Application not found." };
    if (status) {
      const bad = statusChoiceError(tx, userId, app.trackId, status.columnId, status.optionId);
      if (bad) return { ok: false, error: bad };
    }
    const r = insertSubmission(tx, userId, applicationId, fileIds, date, note);
    if (r.ok && status) writeCell(tx, userId, applicationId, status.columnId, "single_select", status.optionId);
    return r;
  });
}

export type SubmissionFileItem = { id: number; originalName: string; storedName: string; label: string; uploadDate: string; integrity: IntegrityState; checkedAt: Date | null };
export type SubmissionItem = { id: number; date: string; note: string | null; files: SubmissionFileItem[] };

// Newest first (date, then id), each with its files in the order they were linked. Two queries, grouped in JS.
export async function listSubmissions(applicationId: number): Promise<SubmissionItem[]> {
  const db = getDb();
  const userId = getUserId();
  const subs = db.select({ id: submissions.id, date: submissions.date, note: submissions.note }).from(submissions)
    .where(and(eq(submissions.applicationId, applicationId), eq(submissions.userId, userId))).orderBy(desc(submissions.date), desc(submissions.id)).all();
  if (subs.length === 0) return [];
  const links = db.select({
    submissionId: submissionFiles.submissionId, id: files.id, originalName: files.originalName, storedName: files.storedName, label: files.label, uploadDate: files.uploadDate, integrity: files.integrity, checkedAt: files.checkedAt,
  }).from(submissionFiles).innerJoin(files, eq(files.id, submissionFiles.fileId))
    .where(and(inArray(submissionFiles.submissionId, subs.map((s) => s.id)), eq(submissionFiles.userId, userId))).orderBy(submissionFiles.id).all();
  const byId = new Map(subs.map((s) => [s.id, { ...s, files: [] as SubmissionFileItem[] }]));
  for (const { submissionId, ...f } of links) byId.get(submissionId)?.files.push(f);
  return subs.map((s) => byId.get(s.id)!);
}
