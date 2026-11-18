// Server-only. Convention for lib/db/<area>.ts: import getDb and tables, export plain async functions returning plain objects
// (never query builders). Async even though better-sqlite3 is sync, so callers don't change when v2 moves to Postgres (NFR-6).
import { and, asc, count, eq, like, ne, sql } from "drizzle-orm";
import {
  TEMPLATES,
  checkTrackColor,
  checkTrackName,
  colorOrFallback,
  defaultTrackColor,
  isTemplateId,
  type TrackTemplate,
} from "../track-templates";
import { PALETTE } from "../colors";
import { starredIds, starredKey } from "../track-star";
import { getDb } from "./client";
import { applications, columnOptions, columns, files, notes, settings, submissions, tracks } from "./schema";
import { setSetting } from "./settings";
import { getUserId } from "./user";

export type TrackListItem = { id: number; name: string; position: number; color: string };

// `color` is always a palette token: a track saved before colours existed gets one from its id.
export async function listTracks(): Promise<TrackListItem[]> {
  return getDb()
    .select({ id: tracks.id, name: tracks.name, position: tracks.position, color: tracks.color })
    .from(tracks)
    .where(eq(tracks.userId, getUserId()))
    .orderBy(asc(tracks.position), asc(tracks.id))
    .all()
    .map((t) => ({ ...t, color: colorOrFallback(t.color, t.id) }));
}

// The sidebar's per-track counts: non-archived applications, one grouped query. A track with none is 0.
export async function listTrackCounts(): Promise<(TrackListItem & { count: number })[]> {
  const db = getDb();
  const userId = getUserId();
  const counts = new Map(
    db
      .select({ trackId: applications.trackId, n: count() })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.archived, false)))
      .groupBy(applications.trackId)
      .all()
      .map((r) => [r.trackId, r.n]),
  );
  return (await listTracks()).map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
}

export type TrackResult = { ok: true } | { ok: false; error: string };
const NO_TRACK = { ok: false, error: "Track not found." } as const;

const otherNames = (excludeId?: number) =>
  getDb()
    .select({ name: tracks.name })
    .from(tracks)
    .where(and(eq(tracks.userId, getUserId()), excludeId === undefined ? undefined : ne(tracks.id, excludeId)))
    .all()
    .map((t) => t.name);

// Writes the template's columns, options, settings and default value for a new last track; synchronous so the seed can run it inside its own transaction (nested, so a savepoint).
// Names and colour are checked by the callers. This is the one place a track is built: `npm run db:seed` and the Add track dialog both come here.
export function insertTrackFromTemplate(name: string, t: TrackTemplate, color: string): number {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const last = tx
      .select({ p: sql<number | null>`max(${tracks.position})` })
      .from(tracks)
      .where(eq(tracks.userId, userId))
      .get()!.p;
    const track = tx
      .insert(tracks)
      .values({ userId, name, color, position: last === null ? 0 : last + 1 })
      .returning()
      .get();
    const put = (key: string, value: unknown) =>
      tx
        .insert(settings)
        .values({ userId, key: `track.${track.id}.${key}`, value: JSON.stringify(value) })
        .run();
    put("expected_labels", t.expectedLabels);
    t.columns.forEach((c, colPos) => {
      const col = tx
        .insert(columns)
        .values({ userId, trackId: track.id, name: c.name, type: c.type, position: colPos, isStatus: !!c.isStatus })
        .returning()
        .get();
      const ids = new Map<string, number>();
      c.options?.forEach(([label, bufferDays], i) => {
        // Palette order, so the first options of a column get distinct colours.
        const o = tx
          .insert(columnOptions)
          .values({ userId, columnId: col.id, label, color: PALETTE[i % PALETTE.length], position: i, bufferDays })
          .returning()
          .get();
        ids.set(label, o.id);
      });
      if (c.isStatus) {
        const ofLabels = (labels: string[]) => labels.map((l) => ids.get(l));
        put("submitted_statuses", ofLabels(t.submitted));
        put("win_statuses", ofLabels(t.wins));
        if (t.stillToDo) put("still_to_do", ofLabels(t.stillToDo));
      }
      if (c.defaultOption)
        tx.update(columns)
          .set({ defaultValue: String(ids.get(c.defaultOption)) })
          .where(eq(columns.id, col.id))
          .run();
    });
    return track.id;
  });
}

// "Add track": the name is trimmed and must be new; the colour is the first one no track uses yet. The template id comes from a POST, so it is checked.
export async function createTrackFromTemplate(
  name: string,
  template: string,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!isTemplateId(template)) return { ok: false, error: "Choose a template." };
  return getDb().transaction(() => {
    const n = checkTrackName(name, otherNames());
    if (!n.ok) return n;
    const color = defaultTrackColor(
      getDb()
        .select({ id: tracks.id, color: tracks.color })
        .from(tracks)
        .where(eq(tracks.userId, getUserId()))
        .all()
        .map((t) => colorOrFallback(t.color, t.id)),
    );
    return { ok: true, id: insertTrackFromTemplate(n.name, TEMPLATES[template], color) } as const;
  });
}

// Rename and recolour in one save. Another track may not have the name (case-insensitive); the track itself may keep it.
export async function updateTrack(id: number, name: string, color: string): Promise<TrackResult> {
  const c = checkTrackColor(color);
  if (!c.ok) return c;
  return getDb().transaction((tx) => {
    const owned = and(eq(tracks.id, id), eq(tracks.userId, getUserId()));
    if (!tx.select({ id: tracks.id }).from(tracks).where(owned).get()) return NO_TRACK;
    const n = checkTrackName(name, otherNames(id));
    if (!n.ok) return n;
    tx.update(tracks).set({ name: n.name, color: c.color }).where(owned).run();
    return { ok: true } as const;
  });
}

export type TrackDeleteImpact = {
  applications: number;
  columns: number;
  submissions: number;
  notes: number;
  files: number;
};

// What deleting the track loses (NFR-4): every application (archived too), its columns, and their submissions, notes and file records (rows; the files on disk stay).
// Takes the connection or a transaction, so deleteTrack counts inside its own transaction.
function countImpact(db: Pick<ReturnType<typeof getDb>, "select">, id: number): TrackDeleteImpact {
  const userId = getUserId();
  const n = (q: { get(): { n: number } | undefined }) => q.get()!.n;
  const ofApps = (table: typeof submissions | typeof notes | typeof files) =>
    n(
      db
        .select({ n: count() })
        .from(table)
        .innerJoin(applications, eq(applications.id, table.applicationId))
        .where(and(eq(applications.trackId, id), eq(applications.userId, userId), eq(table.userId, userId))),
    );
  return {
    applications: n(
      db
        .select({ n: count() })
        .from(applications)
        .where(and(eq(applications.trackId, id), eq(applications.userId, userId))),
    ),
    columns: n(
      db
        .select({ n: count() })
        .from(columns)
        .where(and(eq(columns.trackId, id), eq(columns.userId, userId))),
    ),
    submissions: ofApps(submissions),
    notes: ofApps(notes),
    files: ofApps(files),
  };
}

// Null if the track is missing or not the user's.
export async function getTrackDeleteImpact(id: number): Promise<({ name: string } & TrackDeleteImpact) | null> {
  const t = getDb()
    .select({ name: tracks.name })
    .from(tracks)
    .where(and(eq(tracks.id, id), eq(tracks.userId, getUserId())))
    .get();
  return t ? { name: t.name, ...countImpact(getDb(), id) } : null;
}

// One transaction: the track row (applications, columns, options, values, files, submissions, notes and events go with it via ON DELETE CASCADE) and its `track.<id>.*` settings
// (submitted, win, still-to-do, expected labels, planner slots). Files on disk are not touched. Refuses unless `typedName` is the track's name and `expected` is the impact the user saw.
export async function deleteTrack(id: number, typedName: string, expected: TrackDeleteImpact): Promise<TrackResult> {
  const userId = getUserId();
  return getDb().transaction((tx) => {
    const t = tx
      .select({ name: tracks.name })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.userId, userId)))
      .get();
    if (!t) return NO_TRACK;
    if (typedName !== t.name) return { ok: false, error: "Type the track name to confirm." } as const;
    const now = countImpact(tx, id);
    if ((Object.keys(now) as (keyof TrackDeleteImpact)[]).some((k) => now[k] !== expected[k]))
      return { ok: false, error: "This track changed since the count was shown. Check again." } as const;
    tx.delete(settings)
      .where(and(eq(settings.userId, userId), like(settings.key, `track.${id}.%`)))
      .run();
    tx.delete(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.userId, userId)))
      .run();
    return { ok: true } as const;
  });
}

// The starred tracks: one query over the `track.<id>.starred` settings. A star of a deleted track cannot exist (deleteTrack removes `track.<id>.*`).
export async function getStarredTrackIds(): Promise<Set<number>> {
  return starredIds(
    getDb()
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(and(eq(settings.userId, getUserId()), like(settings.key, "track.%.starred")))
      .all(),
  );
}

// Star or unstar a track the user owns. Unstarring deletes the row (nothing is stored for the common case), so the other `track.<id>.*` cleanup stays the only one there is.
export async function setTrackStarred(id: number, starred: boolean): Promise<TrackResult> {
  const userId = getUserId();
  if (
    !getDb()
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.userId, userId)))
      .get()
  )
    return NO_TRACK;
  if (starred) await setSetting(starredKey(id), true);
  else
    getDb()
      .delete(settings)
      .where(and(eq(settings.userId, userId), eq(settings.key, starredKey(id))))
      .run();
  return { ok: true };
}
