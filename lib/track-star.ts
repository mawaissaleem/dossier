// Pure: which tracks are starred, from the settings rows. No DB or UI imports.

// The setting that holds a track's star: `track.<id>.starred` = true (so deleting the track removes it with its other
// `track.<id>.*` settings). Unstarred = no row.
export const starredKey = (trackId: number) => `track.${trackId}.starred`;

// The ids of the starred tracks from `key`/`value` rows (value = the stored JSON text). Anything else under that key
// shape (hand-edited, `false`, unreadable) is not a star.
export function starredIds(rows: readonly { key: string; value: string }[]): Set<number> {
  const out = new Set<number>();
  for (const { key, value } of rows) {
    const m = /^track\.(\d+)\.starred$/.exec(key);
    if (m && value.trim() === "true") out.add(Number(m[1]));
  }
  return out;
}
