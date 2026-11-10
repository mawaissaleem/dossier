// Pure search logic (task 4.6): query checks, folding, matching and ranking. No DB, React or Next imports.
export const SEARCH_MAX_QUERY = 200;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

// Rank tiers, best first. A title match beats a cell match, which beats a note match; ties go to the newest application (higher id).
export const TIER = { exact: 0, prefix: 1, wordStart: 2, contains: 3, cell: 4, note: 5 } as const;

export type ParsedQuery = { ok: true; query: string } | { ok: false; error: string };

// Missing or blank is fine (empty query = no results); a non-string or an over-long query is an error.
export function parseSearchQuery(raw: unknown): ParsedQuery {
  if (raw === null || raw === undefined) return { ok: true, query: "" };
  if (typeof raw !== "string") return { ok: false, error: "The search must be text." };
  const query = raw.trim();
  if (query.length > SEARCH_MAX_QUERY) return { ok: false, error: `Search for at most ${SEARCH_MAX_QUERY} characters.` };
  return { ok: true, query };
}

export function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n < 1) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), SEARCH_MAX_LIMIT);
}

// Lower-cases and strips accents, so "zurich" finds "Zürich" and "ECOLE" finds "école". SQLite's LIKE folds ASCII only,
// which is why matching happens here and not in SQL. Not folded: "ß" stays "ß" (it does not match "ss").
export const foldText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Same fold, char by char, so `at[i]` = where folded char i starts in the original and `at[text.length]` = the original's length.
// Slower than foldText, so only the one field a snippet is cut from goes through it.
export function foldWithMap(s: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldText(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    text += f;
    i += ch.length;
  }
  at.push(i);
  return { text, at };
}

// The query's distinct folded words. A hit needs every one of them somewhere in the application. `%`, `_` and `\` are
// ordinary characters here (no LIKE is used), so they need no escaping.
export const searchWords = (query: string) => [...new Set(foldText(query).split(/\s+/).filter(Boolean))];

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

// Tier of an application's title (already folded) against the whole folded query; `cell` if the words are not all in the title.
function titleTier(title: string, words: string[]): number {
  const t = title.replace(/\s+/g, " ").trim();
  const phrase = words.join(" ");
  if (t === phrase) return TIER.exact;
  if (t.startsWith(phrase)) return TIER.prefix;
  for (let i = t.indexOf(phrase); i >= 0; i = t.indexOf(phrase, i + 1)) if (i === 0 || !isWordChar(t[i - 1])) return TIER.wordStart;
  if (t.includes(phrase) || words.every((w) => t.includes(w))) return TIER.contains;
  return TIER.cell;
}

export type Matched = { kind: "title" | "cell" | "note"; column: string | null; snippet: string };
export type Match = { tier: number; matched: Matched };

const SNIPPET_BEFORE = 20;
const SNIPPET_AFTER = 40;

// Null unless every word appears in the title, some cell or some note (a query may split across them, as across cells). `matched` is
// the field holding the most words (earliest wins a tie: title, cells, then `notes` in the order given), with a short snippet around
// the first word found in it. Tier: the title's if all words are in the title; else `cell` if title and cells together hold every
// word; else `note` (a note was needed). So a note never outranks a title or cell match, and many notes still make one hit.
export function matchApplication(words: string[], title: string, cells: { column: string; text: string }[], notes: string[] = []): Match | null {
  if (words.length === 0) return null;
  const fields = [
    { kind: "title" as "title" | "cell" | "note", column: null as string | null, text: title },
    ...cells.map((c) => ({ kind: "cell" as const, column: c.column as string | null, text: c.text })),
    ...notes.map((text) => ({ kind: "note" as const, column: null, text })),
  ].map((f) => ({ ...f, folded: foldText(f.text) }));
  const found = new Set<string>();
  const foundOutsideNotes = new Set<string>();
  let best: { field: (typeof fields)[number]; hits: number; word: string } | null = null;
  for (const field of fields) {
    let hits = 0, first = Infinity, word = "";
    for (const w of words) {
      const i = field.folded.indexOf(w);
      if (i < 0) continue;
      hits++;
      found.add(w);
      if (field.kind !== "note") foundOutsideNotes.add(w);
      if (i < first) { first = i; word = w; }
    }
    if (hits > (best?.hits ?? 0)) best = { field, hits, word };
  }
  if (!best || found.size !== words.length) return null;
  const { text } = best.field;
  const { at, text: folded } = foldWithMap(text);
  const start = Math.max(0, folded.indexOf(best.word)); // re-found in the mapped fold, so the offsets always agree with `at`
  const from = Math.max(0, at[start] - SNIPPET_BEFORE);
  const to = Math.min(text.length, at[start + best.word.length] + SNIPPET_AFTER);
  const snippet = (from > 0 ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "…" : "");
  const t = titleTier(fields[0].folded, words);
  const tier = t === TIER.cell && foundOutsideNotes.size !== words.length ? TIER.note : t;
  return { tier, matched: { kind: best.field.kind, column: best.field.column, snippet } };
}

export function rankHits<T extends { tier: number; id: number }>(hits: T[]): T[] {
  return [...hits].sort((a, b) => a.tier - b.tier || b.id - a.id);
}
