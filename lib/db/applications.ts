// Server-only. See lib/db/tracks.ts for the convention.
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { applications, tracks } from "./schema";
import { getUserId } from "./user";

// Returns the new id, or null (nothing inserted) if the track does not exist or is not the current user's.
// No await between the check and the insert, and better-sqlite3 is sync, so nothing can interleave.
export async function createApplication({ title, trackId }: { title: string; trackId: number }): Promise<number | null> {
  const db = getDb();
  const userId = getUserId();
  const track = db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, userId))).get();
  if (!track) return null;
  return db.insert(applications).values({ userId, trackId, title }).returning({ id: applications.id }).get().id;
}

export type ApplicationListItem = { id: number; title: string };

// Non-archived applications of the current user's track, newest first (id breaks ties).
export async function listApplications(trackId: number): Promise<ApplicationListItem[]> {
  return getDb()
    .select({ id: applications.id, title: applications.title })
    .from(applications)
    .where(and(eq(applications.trackId, trackId), eq(applications.userId, getUserId()), eq(applications.archived, false)))
    .orderBy(desc(applications.id))
    .all();
}
