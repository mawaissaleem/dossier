// Pure (no fs, no DB). The stored filename rule (FR-6): "NN-YYYYMMDD-base.ext", e.g. 01-20261108-CV.pdf.
//  - NN is the counter (FR-6.1/6.2): per application, base name, date and extension. 2 digits, 3+ past 99 (FR-6.5).
//    nextSeq is max+1, not count+1, so a gap (a deleted file) never reuses a number. The key is the date plus the rendered
//    tail "base.ext" (or "base" when there is no extension), not base and ext separately: a base may contain dots and the
//    extension may be empty, so (CV, pdf) and (CV.pdf, "") both render CV.pdf and must share a counter. CV.docx and CV.pdf
//    still differ (FR-6.2). The tail is compared case-insensitively (NFC + toLowerCase) because macOS and Windows treat
//    CV.PDF and cv.pdf as the same file. Limit: toLowerCase is not full case folding (straße vs STRASSE count separately).
//  - FR-6.3: after sanitising, every leading "NN-YYYYMMDD-" (NN 2+ digits, a real date) is stripped, so an already-named upload does
//    not get a doubled prefix and shares the counter of its base name. Order: sanitise, strip, sanitise again (repeat while a prefix
//    remains). "01 20261001 CV" is therefore not a prefix (spaces become "_"); 2026-report, 1-20261001-x, a bad date or 7 digits are kept.
//    An empty remainder becomes "file". Sanitise and strip run without the length budget, which is applied once at the end, so a
//    long base and its prefixed form (e.g. our own stored name re-uploaded) truncate to the same base and share a counter.
//  - The date is the user's local upload date as YYYY-MM-DD, chosen by the caller (FR-6.4); todayLocal() gives the default.
//  - base is sanitised by safeName (FR-6.6; device names get a "_", an empty result becomes "file"); the extension is the part
//    after the last dot, lowercased, [a-z0-9] only. A dotfile (.env) or a trailing dot (file.) has no extension.
//  - The whole name stays within 255 UTF-8 bytes: only the base is truncated, and by a budget that depends on the extension but
//    not on the counter, so the stored base name (the counter key) is the same for seq 99 and seq 100.
//    Limit: a counter past 999999 could exceed 255 bytes; not a realistic upload count.
//  - FR-6.7: the result carries originalName unchanged, for the database.
import { parseCell } from "./cells";
import { safeName } from "./safe-name";

export type CounterEntry = { baseName: string; uploadDate: string; extension: string; seq: number };
export type StoredName = CounterEntry & { originalName: string; storedName: string };

const MAX_NAME_BYTES = 255;
const MAX_EXT = 16;
const RESERVED_PREFIX = 6 + 1 + 8 + 1 + 1; // up to a 6-digit counter, "-", YYYYMMDD, "-", plus the "_" safeName may add to a device name
const FALLBACK_BASE = "file";

// Local calendar date (not UTC), so an evening upload gets the user's own day.
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function isValidDate(date: string): boolean {
  const r = parseCell("date", date);
  return r.ok && r.value !== null && date === date.trim();
}

// FR-6.3: one leading "NN-YYYYMMDD-" (NN = 2+ digits, a real date), else the string unchanged.
const PREFIX = /^\d{2,}-(\d{4})(\d{2})(\d{2})-/;
function stripOnePrefix(base: string): string {
  const m = PREFIX.exec(base);
  return m && isValidDate(`${m[1]}-${m[2]}-${m[3]}`) ? base.slice(m[0].length) : base;
}

// Strip after sanitising, so what is stripped is what would be stored (a "_01-20261001-CV" that safeName trims to a prefix is caught),
// then sanitise again (stripping can expose a device name like CON, or an empty base). Each pass shortens the string, so it ends.
// The budget is applied only at the end: truncation keeps the start, so it cannot create a new prefix.
// shortcut: the loop input is capped at PRE_STRIP_CHARS (filesystem names are at most 255 bytes) to keep the repeat loop cheap on a
// hostile name; a longer name is cut before stripping, upgrade only if real names that long appear.
const PRE_STRIP_CHARS = 1024;
function sanitiseAndStrip(rawBase: string, budget: number): string {
  const clean = (s: string) => safeName(s, FALLBACK_BASE, PRE_STRIP_CHARS, Infinity);
  let base = clean(rawBase);
  for (let next = stripOnePrefix(base); next !== base; next = stripOnePrefix(base)) base = clean(next);
  return safeName(base, FALLBACK_BASE, budget, budget);
}

// "report.final.docx" -> { base: "report.final", ext: "docx" }. Raw parts: sanitising happens in buildStoredName.
export function splitOriginalName(originalName: string): { base: string; ext: string } {
  const name = originalName.slice(Math.max(originalName.lastIndexOf("/"), originalName.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, ext: "" }; // no dot, or a dotfile like .env
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

export function safeExtension(ext: string): string {
  return ext.normalize("NFC").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, MAX_EXT);
}

const counterKey = (base: string, date: string, ext: string) => `${date}\0${(ext ? `${base}.${ext}` : base).normalize("NFC").toLowerCase()}`;

// entries: the application's existing files. Returns 1 when none match, otherwise the highest matching seq + 1.
export function nextSeq(entries: Iterable<CounterEntry>, target: { baseName: string; uploadDate: string; extension: string }): number {
  const want = counterKey(target.baseName, target.uploadDate, target.extension);
  let max = 0;
  for (const e of entries) if (e.seq > max && counterKey(e.baseName, e.uploadDate, e.extension) === want) max = e.seq;
  return max + 1;
}

export function formatStoredName(seq: number, date: string, baseName: string, extension: string): string {
  return `${String(seq).padStart(2, "0")}-${date.replaceAll("-", "")}-${baseName}${extension ? `.${extension}` : ""}`;
}

// existing: the entries of ONE application. Throws if date is not a real YYYY-MM-DD date.
export function buildStoredName(originalName: string, date: string, existing: Iterable<CounterEntry>): StoredName {
  if (!isValidDate(date)) throw new Error("uploadDate must be a valid YYYY-MM-DD date.");
  const split = splitOriginalName(originalName);
  const extension = safeExtension(split.ext);
  const budget = MAX_NAME_BYTES - RESERVED_PREFIX - (extension ? extension.length + 1 : 0);
  const baseName = sanitiseAndStrip(split.base, budget);
  const seq = nextSeq(existing, { baseName, uploadDate: date, extension });
  return { originalName, baseName, extension, uploadDate: date, seq, storedName: formatStoredName(seq, date, baseName, extension) };
}
