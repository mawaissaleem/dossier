// Server-only. See lib/db/tracks.ts for the convention. Free-text notes on an application (FR-11.1). Add and list only: editing or
// deleting a note is not asked for (deleting would need an NFR-4 confirmation).
import { and, desc, eq } from "drizzle-orm";
import { checkNoteBody } from "../notes";
import { getDb } from "./client";
import { applications, notes } from "./schema";
import { getUserId } from "./user";

export type NoteItem = { id: number; body: string; createdAt: Date };
// `field` is set when the error belongs to the text box.
export type AddNoteResult = { ok: true; note: NoteItem } | { ok: false; error: string; field?: "body" };

export async function addNote(applicationId: number, body: string): Promise<AddNoteResult> {
  const checked = checkNoteBody(body);
  if (!checked.ok) return { ...checked, field: "body" };
  const userId = getUserId();
  const db = getDb();
  return db.transaction((tx) => {
    if (!tx.select({ id: applications.id }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get()) {
      return { ok: false, error: "Application not found." };
    }
    const note = tx.insert(notes).values({ userId, applicationId, body: checked.body }).returning({ id: notes.id, body: notes.body, createdAt: notes.createdAt }).get();
    return { ok: true, note };
  });
}

// Newest first (created_at, then id: two notes in the same millisecond keep their write order).
export async function listNotes(applicationId: number): Promise<NoteItem[]> {
  return getDb().select({ id: notes.id, body: notes.body, createdAt: notes.createdAt }).from(notes)
    .where(and(eq(notes.applicationId, applicationId), eq(notes.userId, getUserId()))).orderBy(desc(notes.createdAt), desc(notes.id)).all();
}
