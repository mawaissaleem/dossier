// Pure: the "Recently viewed" list of /tracks. No DB or UI imports.
export const MAX_RECENTLY_VIEWED = 6;
export const TRACK_VIEWS = ["table", "board"] as const;
export type TrackView = (typeof TRACK_VIEWS)[number];
export const isTrackView = (v: unknown): v is TrackView => (TRACK_VIEWS as readonly unknown[]).includes(v);
export const TRACK_VIEW_LABELS: Record<TrackView, string> = { table: "Table", board: "Board" };

export type ViewedTrack = { trackId: number; view: TrackView; at: number }; // at = ms since epoch

// The stored setting to a clean list: entries of the right shape only, newest first, one per track and view, at most MAX_RECENTLY_VIEWED. Anything else (hand-edited, a newer version) is dropped.
export function parseViewed(stored: unknown): ViewedTrack[] {
  if (!Array.isArray(stored)) return [];
  const ok = stored.filter((e): e is ViewedTrack => e !== null && typeof e === "object" && Number.isSafeInteger(e.trackId) && e.trackId > 0 && isTrackView(e.view) && Number.isFinite(e.at));
  return dedupe(ok.sort((a, b) => b.at - a.at)).slice(0, MAX_RECENTLY_VIEWED);
}

const dedupe = (sorted: ViewedTrack[]) => sorted.filter((e, i) => sorted.findIndex((o) => o.trackId === e.trackId && o.view === e.view) === i);

// Opening a track page: this view of this track goes first (its older entry is replaced), the list stays capped. A new array.
export function recordViewed(list: readonly ViewedTrack[], entry: ViewedTrack): ViewedTrack[] {
  return [entry, ...list.filter((e) => !(e.trackId === entry.trackId && e.view === entry.view))].slice(0, MAX_RECENTLY_VIEWED);
}

// Deleted tracks drop out (the list is not cleaned when a track goes, only read through this).
export const onlyExisting = <T extends { trackId: number }>(list: readonly T[], trackIds: ReadonlySet<number>): T[] => list.filter((e) => trackIds.has(e.trackId));
