// Pure rules for relocating the files root (8.10, FR-13.1, NFR-6). No DB, no file system: the callers pass real paths in.
import { isInside } from "./files/root";

export type LiveFile = { id: number; relativePath: string; sha256: string; sizeBytes: number };

// Why `target` cannot receive the files of `current`, or null. All three are real (symlink-resolved) absolute paths.
export function targetRefusal(current: string, target: string, backup: string | null): string | null {
  if (isInside(target, current)) return "Choose a folder outside the current files folder (the new folder is the current one or inside it).";
  if (isInside(current, target)) return "Choose a folder that does not contain the current files folder.";
  if (backup && (isInside(target, backup) || isInside(backup, target))) return "Choose a folder that is not the backup folder and does not contain it or sit inside it, or backups and files would mix.";
  return null;
}

export const sumBytes = (rows: { sizeBytes: number }[]) => rows.reduce((s, r) => s + r.sizeBytes, 0);

// Same rows (id, path, hash, size), whatever the order: the set the user confirmed or that was copied is still the live set.
export function sameFiles(a: LiveFile[], b: LiveFile[]): boolean {
  if (a.length !== b.length) return false;
  const key = (f: LiveFile) => `${f.id}\0${f.relativePath}\0${f.sha256}\0${f.sizeBytes}`;
  const seen = new Set(a.map(key));
  return b.every((f) => seen.has(key(f)));
}

// "Not found in the new folder: a, b, c and 4 more." for the Re-point refusal; only the first few are listed.
export function problemsMessage(problems: string[], max = 5): string {
  const shown = problems.slice(0, max).join(", ");
  const more = problems.length - max;
  return `${problems.length === 1 ? "1 file" : `${problems.length} files`} not found in that folder with the recorded size: ${shown}${more > 0 ? ` and ${more} more` : ""}. Nothing was changed. Move the whole folder (every file in its folder) there, then try again.`;
}

export const parseExpected = (v: unknown): { fileCount: number; totalBytes: number } | null => {
  const o = v as { fileCount?: unknown; totalBytes?: unknown } | null;
  return o && typeof o === "object" && Number.isSafeInteger(o.fileCount) && Number.isSafeInteger(o.totalBytes) && (o.fileCount as number) >= 0 && (o.totalBytes as number) >= 0
    ? { fileCount: o.fileCount as number, totalBytes: o.totalBytes as number } : null;
};
