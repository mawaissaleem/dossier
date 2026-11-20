import { cache } from "react";
import { connection } from "next/server";
import { pendingMigrations } from "@/lib/db/migrations";
import { listTrackCounts } from "@/lib/db/tracks";
import { TrackNavLinks } from "./track-nav-links";

// The side and phone navigations both show this; `cache` makes the second one free (one grouped count query per
// request).
const counts = cache(listTrackCounts);

// The sidebar's track links with their counts, shown when the sidebar is expanded. Request-time, so the layout wraps it
// in its own Suspense with no fallback: the rest of the navigation stays in the static shell and the links appear as
// soon as the query returns. A database behind the migrations (the DatabaseGate case) shows no links instead of
// crashing every page.
export async function TrackNav() {
  await connection();
  if (pendingMigrations() > 0) return null;
  const tracks = await counts();
  return tracks.length ? <TrackNavLinks tracks={tracks} /> : null;
}
