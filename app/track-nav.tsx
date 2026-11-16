import { connection } from "next/server";
import { pendingMigrations } from "@/lib/db/migrations";
import { listTrackCounts } from "@/lib/db/tracks";
import { TrackNavLinks } from "./track-nav-links";

// The sidebar's track links with their counts. Request-time (one grouped count query), so the layout wraps it in its own Suspense with no fallback: the rest of the navigation stays in the
// static shell and the links appear as soon as the query returns. A database behind the migrations (the DatabaseGate case) shows no links instead of crashing every page.
export async function TrackNav() {
  await connection();
  if (pendingMigrations() > 0) return null;
  const tracks = await listTrackCounts();
  return tracks.length ? <TrackNavLinks tracks={tracks} /> : null;
}
