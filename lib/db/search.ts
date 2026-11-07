// Server-only. See lib/db/tracks.ts for the convention.
// Global search (FR-10.1). No FTS5 and no SQL LIKE: the current user's title and text/link cells are read in 2 queries and matched in
// JS (lib/search.ts), because SQLite's LIKE and FTS5 do not fold non-ASCII ("Zürich"), and an FTS index would need keeping in sync on
// every write path. Measured in .claude/work/4.6/coder-1.md. shortcut: reads every text cell per search, fine for thousands of rows;
// if it ever nears 100 ms, move to FTS5 (trigram) kept in sync by triggers. Notes (phase 7): add a third query for note text and
// pass it to matchApplication as more fields.
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { clampLimit, matchApplication, rankHits, searchWords, SEARCH_MAX_QUERY, type Matched } from "../search";
import { getDb } from "./client";
import { applications, cellValues, columns, tracks } from "./schema";
import { getUserId } from "./user";

export type SearchHit = { id: number; title: string; archived: boolean; track: { id: number; name: string }; matched: Matched };

// Current user only, all tracks. Matches the title and every text and link cell (hidden columns too; a link is often the company's
// site). Archived applications are included and flagged: the user may be answering an old email, and the UI can dim them.
// Blank or over-long query = []. Order: see rankHits; at most `limit` (default 20, max 50) hits.
export async function searchApplications(query: string, { limit }: { limit?: number } = {}): Promise<SearchHit[]> {
  const q = query.trim();
  const words = searchWords(q);
  if (!q || q.length > SEARCH_MAX_QUERY || words.length === 0) return [];
  const db = getDb();
  const userId = getUserId();
  const apps = db
    .select({ id: applications.id, title: applications.title, archived: applications.archived, trackId: tracks.id, trackName: tracks.name })
    .from(applications)
    .innerJoin(tracks, and(eq(tracks.id, applications.trackId), eq(tracks.userId, userId)))
    .where(eq(applications.userId, userId))
    .all();
  // Column order, so the earliest column wins when a query matches several cells equally.
  const cells = db
    .select({ applicationId: cellValues.applicationId, column: columns.name, text: cellValues.valueText })
    .from(cellValues)
    .innerJoin(columns, and(eq(columns.id, cellValues.columnId), eq(columns.userId, userId), inArray(columns.type, ["text", "link"])))
    .where(and(eq(cellValues.userId, userId), isNotNull(cellValues.valueText)))
    .orderBy(asc(columns.position), asc(columns.id))
    .all();
  const byApp = new Map<number, { column: string; text: string }[]>();
  for (const c of cells) {
    const list = byApp.get(c.applicationId);
    if (list) list.push({ column: c.column, text: c.text! });
    else byApp.set(c.applicationId, [{ column: c.column, text: c.text! }]);
  }
  const hits = apps.flatMap((a) => {
    const m = matchApplication(words, a.title, byApp.get(a.id) ?? []);
    return m ? [{ id: a.id, title: a.title, archived: a.archived, track: { id: a.trackId, name: a.trackName }, matched: m.matched, tier: m.tier }] : [];
  });
  return rankHits(hits).slice(0, clampLimit(limit)).map((h) => ({ id: h.id, title: h.title, archived: h.archived, track: h.track, matched: h.matched }));
}
