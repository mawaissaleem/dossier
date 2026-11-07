// Pure logic for the search palette (task 4.7). No DOM, React or DB imports.
import { foldWithMap, searchWords } from "./search";

export type Segment = { text: string; match: boolean };

// Splits `text` into runs, marking the parts that match a query word (folded: case and accents ignored, like the search itself).
// Returns plain strings only; the caller renders them as React text, so nothing in `text` is ever read as HTML.
export function highlightSegments(text: string, query: string): Segment[] {
  const words = searchWords(query);
  if (!text) return [];
  const { text: folded, at } = foldWithMap(text);
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + 1)) hit.fill(true, at[i], at[i + w.length]);
  }
  const out: Segment[] = [];
  let from = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && hit[i] === hit[from]) continue;
    out.push({ text: text.slice(from, i), match: hit[from] });
    from = i;
  }
  return out;
}

export const isMacPlatform = (platform: string) => /mac|iphone|ipad|ipod/i.test(platform);

// The shortcut as shown to the user.
export const chordLabel = (mac: boolean) => (mac ? "⌘K" : "Ctrl K");

// Cmd+K on macOS, Ctrl+K elsewhere; no other modifier. (Ctrl+K on a Mac is kill-line in text fields, so it is left alone there.)
export function isSearchChord(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean) {
  return e.key.toLowerCase() === "k" && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;
}

// Moves the active result by `delta`, wrapping at both ends. 0 when the list is empty.
export const wrapIndex = (current: number, delta: number, length: number) => (length <= 0 ? 0 : (((current + delta) % length) + length) % length);
