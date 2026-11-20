// Server-only. The "Recently viewed" list of /tracks: one settings row (JSON list, newest first), see
// lib/recently-viewed.ts for the rules.
import { and, eq } from "drizzle-orm";
import { isTrackView, parseViewed, recordViewed, type ViewedTrack } from "../recently-viewed";
import { relativeTime } from "../track-overview";
import { getDb } from "./client";
import { readSetting, setSetting } from "./settings";
import { tracks } from "./schema";
import type { TrackResult } from "./tracks";
import { getUserId } from "./user";

export const RECENTLY_VIEWED_KEY = "tracks.recently_viewed";

// Cleaned on every read, with each entry's age in words ("10 minutes ago"); deleted tracks are filtered by the page,
// which already has the track list.
export async function getRecentlyViewed(nowMs: number = Date.now()): Promise<(ViewedTrack & { when: string })[]> {
  return parseViewed(readSetting(RECENTLY_VIEWED_KEY)).map((e) => ({ ...e, when: relativeTime(e.at, nowMs) }));
}

// Called when a track page is opened (a client effect posts it; nothing writes during render). The read and the write
// run with no await between them, so two calls cannot interleave. `view` and `trackId` come from a POST, so both are
// checked here; an unknown or foreign track is refused and nothing is written.
export async function recordTrackView(trackId: number, view: string, nowMs: number = Date.now()): Promise<TrackResult> {
  if (
    !isTrackView(view) ||
    !getDb()
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.userId, getUserId())))
      .get()
  )
    return { ok: false, error: "Track not found." };
  await setSetting(
    RECENTLY_VIEWED_KEY,
    recordViewed(parseViewed(readSetting(RECENTLY_VIEWED_KEY)), { trackId, view, at: nowMs }),
  );
  return { ok: true };
}
