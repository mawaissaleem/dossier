// Pure rules for reading a backup zip back (no fs, no DB). Task 8.4 (restore). Layout: lib/backup.ts. The reader is lib/files/restore.ts.
//
// A backup zip is untrusted input (it may be damaged, hand-made or hostile), so the entry list is judged from the central directory
// BEFORE any byte is read or written. Refused outright (the whole restore stops, nothing is changed):
//   - names with a NUL, a backslash, a leading "/", a drive letter ("C:"), a "." or ".." segment (zip-slip), and the Windows forms
//     lib/files/relative.ts already refuses for stored paths (colon, trailing dot or space); duplicate names; a file that is also a folder
//   - any entry that is not the manifest, the database or a regular file under files/ (a folder entry is allowed only when empty)
//   - symlinks and other special entry types (read from the Unix mode in the entry's attributes), encrypted entries, and compression
//     methods other than stored/deflate
//   - zip bombs: LIMITS below. The numbers: 50,000 entries (a backup holds one entry per stored file, so tens to a few thousand);
//     20 GiB uncompressed in total (far above a personal archive of CVs and letters, far below what a bomb needs to hurt, and the free
//     space check in the reader is the real guard); a 500:1 compression ratio for any entry over 1 MiB (deflate tops out near 1000:1,
//     real PDFs and databases stay well under 100:1); manifest at most 64 KiB. The reader also refuses an entry whose real size differs
//     from its declared size, so the declared sizes checked here can be trusted.
import { DB_ENTRY, FILES_PREFIX, MANIFEST_NAME } from "./backup";
import { checkRelativePath } from "./files/relative";

export const LIMITS = {
  maxEntries: 50_000,
  maxTotalBytes: 20 * 1024 ** 3,
  maxRatio: 500,
  ratioFloorBytes: 1024 ** 2, // smaller entries are exempt: a few KB of zeros legitimately compresses a lot
  maxManifestBytes: 64 * 1024,
};
export type Limits = typeof LIMITS;

// Restore's staging and aside folders (next to the database and at the top of the files folder). Backups skip them in the files folder.
export const STAGE_PREFIX = ".dossier-restore-";

// The settings that belong to THIS computer and survive a restore (their current values are kept, or stay unset). A backup made on
// another machine would otherwise bring its files folder path, backup folder and reminder with it: the files folder would point
// somewhere that does not exist here, and restoring must never silently change where files are stored or where backups go.
// Everything else in settings (file labels, expected labels, submitted statuses) is app content and comes from the backup.
export const KEPT_SETTING_KEYS = ["files_root", "backup_destination", "backup_reminder_days", "last_backup_at"] as const;

export type ZipEntryInfo = { name: string; flags: number; method: number; compressedSize: number; uncompressedSize: number; versionMadeBy: number; externalAttributes: number };
export type EntryKind = "file" | "dir" | "symlink" | "other";

// Unix mode lives in the top 16 bits of the external attributes when the entry was made on Unix (host 3) or macOS (host 19);
// elsewhere only the DOS directory bit (0x10) exists.
export function entryKind(e: Pick<ZipEntryInfo, "name" | "versionMadeBy" | "externalAttributes">): EntryKind {
  const host = e.versionMadeBy >> 8;
  if (host === 3 || host === 19) {
    const type = ((e.externalAttributes >>> 16) & 0xffff) & 0o170000;
    if (type === 0o120000) return "symlink";
    if (type === 0o040000) return "dir";
    if (type !== 0o100000 && type !== 0) return "other";
  } else if (e.externalAttributes & 0x10) {
    return "dir";
  }
  return e.name.endsWith("/") ? "dir" : "file";
}

export type Listing = { ok: true; files: Map<string, number>; dbBytes: number; totalBytes: number } | { ok: false; error: string };

const shown = (name: string) => JSON.stringify(name.length > 80 ? `${name.slice(0, 80)}...` : name);
const bad = (error: string): Listing => ({ ok: false, error });

export function checkListing(entries: ZipEntryInfo[], limits: Limits = LIMITS): Listing {
  if (entries.length > limits.maxEntries) return bad(`This backup holds too many entries (${entries.length}; the limit is ${limits.maxEntries}).`);
  const seen = new Set<string>();
  const files = new Map<string, number>(); // relative path -> size
  let hasManifest = false;
  let dbBytes: number | null = null;
  let totalBytes = 0;

  for (const e of entries) {
    const { name } = e;
    if (name.includes("\0") || name.includes("\\")) return bad(`The backup has an entry with an unsafe name (${shown(name)}). It was not restored.`);
    const bare = name.endsWith("/") ? name.slice(0, -1) : name;
    if (bare === "" || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || bare.split("/").some((s) => s === ".." || s === "." || s === "")) {
      return bad(`The backup has an entry that points outside its own folder (${shown(name)}). It was not restored.`);
    }
    if (seen.has(bare)) return bad(`The backup lists ${shown(name)} twice.`);
    seen.add(bare);

    const kind = entryKind(e);
    if (kind === "symlink" || kind === "other") return bad(`The backup holds a link or special entry (${shown(name)}). Only regular files are allowed.`);
    if (e.flags & 1) return bad(`The backup holds an encrypted entry (${shown(name)}). Dossier backups are not encrypted.`);
    if (e.method !== 0 && e.method !== 8) return bad(`The backup uses an unsupported compression method (${shown(name)}).`);

    if (kind === "dir") {
      if (e.uncompressedSize !== 0) return bad(`The backup has a folder entry with data in it (${shown(name)}).`);
      const ok = bare === "database" || bare === "files" || (bare.startsWith(FILES_PREFIX) && checkRelativePath(bare.slice(FILES_PREFIX.length)).ok);
      if (!ok) return bad(`The backup holds an unexpected entry (${shown(name)}).`);
      continue;
    }

    if (e.uncompressedSize > limits.ratioFloorBytes && e.uncompressedSize / Math.max(e.compressedSize, 1) > limits.maxRatio) {
      return bad(`The backup entry ${shown(name)} is compressed far beyond what a real file shows (a zip bomb?). It was not restored.`);
    }
    totalBytes += e.uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) return bad(`The backup would unpack to more than ${Math.round(limits.maxTotalBytes / 1024 ** 3)} GB. It was not restored.`);

    if (name === MANIFEST_NAME) {
      if (e.uncompressedSize > limits.maxManifestBytes) return bad("The backup manifest is too large.");
      hasManifest = true;
    } else if (name === DB_ENTRY) {
      dbBytes = e.uncompressedSize;
    } else if (name.startsWith(FILES_PREFIX)) {
      const rel = checkRelativePath(name.slice(FILES_PREFIX.length));
      if (!rel.ok) return bad(`The backup has a file with an unsafe name (${shown(name)}): ${rel.error}`);
      files.set(rel.path, e.uncompressedSize);
    } else {
      return bad(`The backup holds an unexpected entry (${shown(name)}). Only the manifest, the database and files/ are allowed.`);
    }
  }
  if (!hasManifest) return bad("This zip has no manifest.json, so it is not a Dossier backup.");
  if (dbBytes === null) return bad("This backup has no database in it.");
  // "files/a" as a file and "files/a/b" under it cannot both exist on disk.
  for (const rel of files.keys()) {
    for (let i = rel.indexOf("/"); i !== -1; i = rel.indexOf("/", i + 1)) {
      if (files.has(rel.slice(0, i))) return bad(`The backup has ${shown(rel.slice(0, i))} as both a file and a folder.`);
    }
  }
  return { ok: true, files, dbBytes, totalBytes };
}

// A backup whose database is from a newer version of the app cannot be read by this one: refuse rather than guess.
export const schemaIsNewer = (backupLatest: number | null, appLatest: number | null) => backupLatest !== null && (appLatest === null || backupLatest > appLatest);

// What the user is told about files that are missing from the zip or whose bytes differ from the recorded SHA-256.
export function describeFileProblems(kind: "missing" | "changed", paths: string[]): string {
  const list = paths.slice(0, 3).join(", ") + (paths.length > 3 ? ` and ${paths.length - 3} more` : "");
  return kind === "missing"
    ? `${paths.length} file${paths.length === 1 ? "" : "s"} the backup's database lists ${paths.length === 1 ? "is" : "are"} missing from the zip: ${list}. The backup is incomplete, so it was not restored.`
    : `${paths.length} file${paths.length === 1 ? "" : "s"} in the backup ${paths.length === 1 ? "does" : "do"} not match the checksum recorded in the database: ${list}. The backup is damaged, so it was not restored.`;
}

export type Counts = { applications: number; columns: number; files: number; submissions: number; notes: number };
export const COUNT_KEYS = ["applications", "columns", "files", "submissions", "notes"] as const;
export const sameCounts = (a: Counts, b: Counts) => COUNT_KEYS.every((k) => a[k] === b[k]);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

// What the dialog showed: the backup's date and the current counts. The action takes unknown (any POST).
export type Expected = { createdAt: string; counts: Counts };
export function parseExpected(input: unknown): Expected | null {
  if (typeof input !== "object" || input === null) return null;
  const { createdAt, counts } = input as Record<string, unknown>;
  if (typeof createdAt !== "string" || typeof counts !== "object" || counts === null) return null;
  const c = counts as Record<string, unknown>;
  if (!COUNT_KEYS.every((k) => isCount(c[k]))) return null;
  return { createdAt, counts: Object.fromEntries(COUNT_KEYS.map((k) => [k, c[k]])) as Counts };
}
