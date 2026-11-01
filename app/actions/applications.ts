"use server";

import { refresh } from "next/cache";
import { createApplication as insertApplication } from "@/lib/db/applications";

export type CreateApplicationResult = { ok: true; id: number } | { ok: false; error: string };

const MAX_TITLE = 300;

// Plain args (not FormData): 1.2's form can call this from a client handler and show result.error inline.
// refresh() (not revalidatePath): the track page reads the DB at request time, nothing is cached, so only the client router's payload is stale.
export async function createApplication(title: string, trackId: number): Promise<CreateApplicationResult> {
  // Runs on any POST, so don't trust the TS types.
  if (typeof title !== "string") return { ok: false, error: "Title is required." };
  const t = title.trim();
  if (!t) return { ok: false, error: "Title is required." };
  if (t.length > MAX_TITLE) return { ok: false, error: `Title must be at most ${MAX_TITLE} characters.` };
  if (typeof trackId !== "number" || !Number.isSafeInteger(trackId) || trackId < 1) return { ok: false, error: "Invalid track." };

  const id = await insertApplication({ title: t, trackId });
  if (id === null) return { ok: false, error: "Track not found." };
  refresh();
  return { ok: true, id };
}
