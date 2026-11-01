// Server-only. Convention for lib/db/<area>.ts: import getDb and tables, export plain async functions returning plain objects
// (never query builders). Async even though better-sqlite3 is sync, so callers don't change when v2 moves to Postgres (NFR-6).
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { tracks } from "./schema";
import { getUserId } from "./user";

export type TrackListItem = { id: number; name: string; position: number };

export async function listTracks(): Promise<TrackListItem[]> {
  return getDb()
    .select({ id: tracks.id, name: tracks.name, position: tracks.position })
    .from(tracks)
    .where(eq(tracks.userId, getUserId()))
    .orderBy(asc(tracks.position), asc(tracks.id))
    .all();
}

// Null if missing or not the current user's.
export async function getTrack(id: number): Promise<TrackListItem | null> {
  return (
    getDb()
      .select({ id: tracks.id, name: tracks.name, position: tracks.position })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.userId, getUserId())))
      .get() ?? null
  );
}
