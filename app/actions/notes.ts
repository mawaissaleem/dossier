"use server";

import { refresh } from "next/cache";
import { addNote } from "@/lib/db/notes";
import { isId } from "@/lib/ids";

// Runs on any POST, so the id and the body type are checked here; the body's content rules are in the data layer (lib/notes.ts).
// refresh() only on success, so a refused note stays in the box. `field: "body"` marks errors that belong to the text box.
export async function createNote(applicationId: number, body: string): Promise<{ ok: true } | { ok: false; error: string; field?: "body" }> {
  if (!isId(applicationId)) return { ok: false, error: "Application not found." };
  if (typeof body !== "string") return { ok: false, error: "Write a note first.", field: "body" };
  const r = await addNote(applicationId, body);
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}
