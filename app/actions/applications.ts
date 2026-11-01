"use server";

import { createApplication as insertApplication } from "@/lib/db/applications";

export type CreateApplicationResult = { ok: true; id: number } | { ok: false; error: string };

const MAX_TITLE = 300;

// Plain args (not FormData): 1.2's form can call this from a client handler and show result.error inline.
// No revalidatePath yet: no page lists applications; add it in 1.2/1.4 for the page that does.
export async function createApplication(title: string, trackId: number): Promise<CreateApplicationResult> {
  // Runs on any POST, so don't trust the TS types.
  if (typeof title !== "string") return { ok: false, error: "Title is required." };
  const t = title.trim();
  if (!t) return { ok: false, error: "Title is required." };
  if (t.length > MAX_TITLE) return { ok: false, error: `Title must be at most ${MAX_TITLE} characters.` };
  if (typeof trackId !== "number" || !Number.isSafeInteger(trackId) || trackId < 1) return { ok: false, error: "Invalid track." };

  const id = await insertApplication({ title: t, trackId });
  return id === null ? { ok: false, error: "Track not found." } : { ok: true, id };
}
