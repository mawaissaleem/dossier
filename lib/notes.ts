// Pure (no DB, no UI). Rules for an application note (FR-11.1), shared by the data layer and the form.
export const NOTE_BODY_MAX = 5000;

export type NoteBodyResult = { ok: true; body: string } | { ok: false; error: string };

// JS trim() covers Unicode whitespace (U+00A0, U+2028, ...) that the DB CHECK on notes.body misses (7.1 review). Zero-width characters
// are not whitespace to JS but show as nothing, so a body of only those counts as blank. Line breaks inside the text are kept.
export function checkNoteBody(body: unknown): NoteBodyResult {
  if (typeof body !== "string") return { ok: false, error: "Write a note first." };
  const trimmed = body.trim();
  if (/^[\s​-‍⁠﻿]*$/.test(trimmed)) return { ok: false, error: "Write a note first." };
  if (trimmed.length > NOTE_BODY_MAX) return { ok: false, error: `A note can be at most ${NOTE_BODY_MAX.toLocaleString("en-US")} characters.` };
  return { ok: true, body: trimmed };
}
