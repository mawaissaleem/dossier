"use server";

import { refresh } from "next/cache";
import { createTrackFromTemplate, deleteTrack as remove, getTrackDeleteImpact, updateTrack as change, type TrackDeleteImpact, type TrackResult } from "@/lib/db/tracks";
import { isId } from "@/lib/ids";

const bad = { ok: false, error: "Track not found." } as const;

// Runs on any POST, so the argument types are checked here; the name, colour and ownership rules live in the data layer.
// refresh() only on success (nothing changed otherwise, and the dialog keeps what was typed); it also re-renders the layout, so the sidebar's track list is current.
export async function createTrack(name: string, template: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (typeof name !== "string") return { ok: false, error: "Name is required." };
  const r = await createTrackFromTemplate(name, template);
  if (r.ok) refresh();
  return r;
}

export async function updateTrack(id: number, name: string, color: string): Promise<TrackResult> {
  if (!isId(id)) return bad;
  if (typeof name !== "string") return { ok: false, error: "Name is required." };
  const r = await change(id, name, color);
  if (r.ok) refresh();
  return r;
}

// Read on each dialog open so the counts are never stale page data.
export async function fetchTrackDeleteImpact(id: number): Promise<({ ok: true; name: string } & TrackDeleteImpact) | { ok: false; error: string }> {
  if (!isId(id)) return bad;
  const impact = await getTrackDeleteImpact(id);
  return impact ? { ok: true, ...impact } : bad;
}

const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

// `confirm` must be literally true and `typedName` is what the user typed; `expected` is the impact the dialog showed (the data layer refuses if it changed).
// No refresh(): the track page would re-render as a 404 before the client leaves it; the client pushes to /tracks and refreshes.
export async function deleteTrack(id: number, confirm: boolean, typedName: string, expected: TrackDeleteImpact): Promise<TrackResult> {
  const keys = ["applications", "columns", "submissions", "notes", "files"] as const;
  if (confirm !== true || typeof typedName !== "string" || typeof expected !== "object" || expected === null || !keys.every((k) => count(expected[k]))) return { ok: false, error: "Deleting must be confirmed." };
  if (!isId(id)) return bad;
  return remove(id, typedName, { applications: expected.applications, columns: expected.columns, submissions: expected.submissions, notes: expected.notes, files: expected.files });
}
