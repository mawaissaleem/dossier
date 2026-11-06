"use server";

import { refresh } from "next/cache";
import { MAX_TEXT } from "@/lib/cells";
import { createApplication as insertApplication, updateApplication as changeApplication } from "@/lib/db/applications";
import { MAX_COLUMNS } from "@/lib/db/columns";
import { isId } from "@/lib/ids";

export type CreateApplicationResult = { ok: true; id: number } | { ok: false; error: string };

const MAX_TITLE = 300;

// Payload shape bounds, never tighter than what the form can hold: one entry per column (addColumn caps the count), and strings well
// above parseCell's MAX_TEXT so an over-long field gets parseCell's error naming the column, not "Invalid form data.".
const MAX_VALUES = MAX_COLUMNS;
const MAX_VALUE_TEXT = 10 * MAX_TEXT;

// `values` is the form's payload: [{ columnId, value }], value a string, number, boolean or null (blank). A column listed there is
// the user's choice, blank included; a column left out gets its default. Omit `values` for a title-only application.
// Plain args (not FormData): the form calls this from a client handler and shows result.error inline.
// refresh() (not revalidatePath): the track page reads the DB at request time, nothing is cached, so only the client router's payload is stale.
export async function createApplication(title: string, trackId: number, values?: { columnId: number; value: string | number | boolean | null }[]): Promise<CreateApplicationResult> {
  // Runs on any POST, so don't trust the TS types.
  const t = checkTitle(title);
  if (!t.ok) return t;
  if (!isId(trackId)) return { ok: false, error: "Invalid track." };
  if (values !== undefined && !validValues(values)) return { ok: false, error: "Invalid form data." };

  const r = await insertApplication({ title: t.title, trackId, values });
  if (r.ok) refresh();
  return r;
}

// Edit form save (same limits as create). `values` is required and holds only the fields the user changed, blank (null) included.
// refresh() only on success: nothing changed otherwise, and the form keeps what was typed.
export async function updateApplication(id: number, title: string, values: { columnId: number; value: string | number | boolean | null }[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isId(id)) return { ok: false, error: "Application not found." };
  const t = checkTitle(title);
  if (!t.ok) return t;
  if (!validValues(values)) return { ok: false, error: "Invalid form data." };
  const r = await changeApplication({ id, title: t.title, values });
  if (r.ok) refresh();
  return r;
}

function checkTitle(title: unknown): { ok: true; title: string } | { ok: false; error: string } {
  if (typeof title !== "string" || !title.trim()) return { ok: false, error: "Title is required." };
  const t = title.trim();
  return t.length > MAX_TITLE ? { ok: false, error: `Title must be at most ${MAX_TITLE} characters.` } : { ok: true, title: t };
}

function validValues(v: unknown): v is { columnId: number; value: string | number | boolean | null }[] {
  return Array.isArray(v) && v.length <= MAX_VALUES && v.every((e) =>
    typeof e === "object" && e !== null && !Array.isArray(e) && isId(e.columnId) &&
    (e.value === null || typeof e.value === "number" || typeof e.value === "boolean" || (typeof e.value === "string" && e.value.length <= MAX_VALUE_TEXT)));
}
