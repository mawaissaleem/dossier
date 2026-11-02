"use server";

import { refresh } from "next/cache";
import { archiveApplication as setArchived, deleteApplication as removeApplication } from "@/lib/db/applications";

const isId = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1;

export type ActionResult = { ok: true } | { ok: false; error: string };

// Runs on any POST, so the arguments are checked here, not trusted from the TS types.
export async function archiveApplication(id: number, archived: boolean): Promise<ActionResult> {
  if (!isId(id) || typeof archived !== "boolean") return { ok: false, error: "Application not found." };
  if (!(await setArchived(id, archived))) return { ok: false, error: "Application not found." };
  refresh();
  return { ok: true };
}

// `confirm` must be literally true: the UI sets it only after the user saw what will be lost (FR-1.9, NFR-4).
// No refresh(): the detail page would re-render as a 404 before the client navigates to the track page (trackId).
export async function deleteApplication(id: number, confirm: boolean): Promise<{ ok: true; trackId: number } | { ok: false; error: string }> {
  if (confirm !== true) return { ok: false, error: "Deleting must be confirmed." };
  if (!isId(id)) return { ok: false, error: "Application not found." };
  const trackId = await removeApplication(id);
  return trackId === null ? { ok: false, error: "Application not found." } : { ok: true, trackId };
}
