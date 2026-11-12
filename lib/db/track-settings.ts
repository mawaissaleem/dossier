// Server-only. Per-track settings stored in the settings table as `track.<id>.<name>` (see lib/db/settings.ts).
import { and, asc, eq } from "drizzle-orm";
import { checkExpectedLabels, resolveExpectedLabels } from "../expected-labels";
import { checkSubmittedIds, resolveSubmittedStatuses } from "../submitted-statuses";
import { getDb } from "./client";
import { applications, columnOptions, columns, tracks } from "./schema";
import { getUserId } from "./user";
import { getSetting, readSetting, setSetting } from "./settings";

export type SubmittedResult = { ok: true } | { ok: false; error: string };

export const submittedKey = (trackId: number) => `track.${trackId}.submitted_statuses`;
export const expectedLabelsKey = (trackId: number) => `track.${trackId}.expected_labels`;

// Options of the track's current status column, in order. Empty when the track is not the user's or has no status column.
export function statusOptions(trackId: number) {
  const userId = getUserId();
  return getDb()
    .select({ id: columnOptions.id, label: columnOptions.label, color: columnOptions.color })
    .from(columnOptions)
    .innerJoin(columns, eq(columns.id, columnOptions.columnId))
    .innerJoin(tracks, eq(tracks.id, columns.trackId))
    .where(and(eq(tracks.id, trackId), eq(tracks.userId, userId), eq(columns.userId, userId), eq(columns.isStatus, true), eq(columnOptions.userId, userId)))
    .orderBy(asc(columnOptions.position), asc(columnOptions.id))
    .all();
}

// Option ids that count as submitted. Saved ids that are no longer status options (deleted, or a switched status column) are dropped silently.
// Never saved: options labelled Applied / Submitted (case-insensitive), so a database made before this setting existed still works.
export async function getSubmittedStatuses(trackId: number): Promise<number[]> {
  return submittedStatusIds(trackId);
}

// Same, synchronous (used inside transactions).
export function submittedStatusIds(trackId: number): number[] {
  return resolveSubmittedStatuses(readSetting(submittedKey(trackId)), statusOptions(trackId));
}

// For the track's status options with their current checked state (the settings page).
export async function getSubmittedChoices(trackId: number) {
  const options = statusOptions(trackId);
  const on = new Set(resolveSubmittedStatuses(await getSetting(submittedKey(trackId)), options));
  return options.map((o) => ({ ...o, submitted: on.has(o.id) }));
}

export async function isSubmittedStatus(trackId: number, optionId: number | null): Promise<boolean> {
  return optionId !== null && (await getSubmittedStatuses(trackId)).includes(optionId);
}

// Replaces the set. Refuses ids that are not options of this track's status column; an empty list is allowed (nothing counts as submitted).
export async function setSubmittedStatuses(trackId: number, ids: unknown): Promise<SubmittedResult> {
  const options = statusOptions(trackId);
  if (!options.length) return { ok: false, error: "This track has no status options." };
  const checked = checkSubmittedIds(ids, options);
  if ("error" in checked) return { ok: false, error: checked.error };
  await setSetting(submittedKey(trackId), checked.ids);
  return { ok: true };
}

const ownsTrack = (trackId: number) =>
  getDb().select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, getUserId()))).get() !== undefined;

// The labels a file set should have (FR-7.3). Never saved or unreadable -> empty list (no warning); the seed is the only source of defaults.
export async function getExpectedLabels(trackId: number): Promise<string[]> {
  return resolveExpectedLabels(await getSetting(expectedLabelsKey(trackId)));
}

// Replaces the list after validating it (see checkExpectedLabels). Refuses tracks that are not the user's; nothing is saved on error.
export async function setExpectedLabels(trackId: number, labels: unknown): Promise<SubmittedResult> {
  if (!ownsTrack(trackId)) return { ok: false, error: "Track not found." };
  const checked = checkExpectedLabels(labels);
  if ("error" in checked) return { ok: false, error: checked.error };
  await setSetting(expectedLabelsKey(trackId), checked.labels);
  return { ok: true };
}

// The expected labels of the track the application is in (the review dialog); [] for an unknown application.
export async function getApplicationExpectedLabels(applicationId: number): Promise<string[]> {
  const a = getDb().select({ trackId: applications.trackId }).from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, getUserId()))).get();
  return a ? getExpectedLabels(a.trackId) : [];
}
