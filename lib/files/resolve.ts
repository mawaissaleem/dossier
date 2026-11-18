// Server-only. The one place that turns (files root, stored relative path) into an absolute path. Nothing else joins under the root.
// Limit: the check and the later open are separate steps, so a symlink swapped in between is not caught (single-user, local app).
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { appDirs, isInside } from "./root";
import { checkRelativePath, isFullyAbsolute, type PathResult } from "./relative";

const fail = (error: string): PathResult => ({ ok: false, error });
const refused = fail("That file path is not allowed.");
export const ROOT_MISSING = "The files folder was not found. If you moved it, use Re-point in Settings.";

// Real path of the target, or of its nearest existing parent plus the not-yet-existing tail (files are created later).
async function realTarget(abs: string): Promise<string | null> {
  const tail: string[] = [];
  for (let p = abs; ; p = dirname(p)) {
    try {
      return join(await realpath(p), ...tail);
    } catch {
      // realpath failed. A symlink here is dangling or looping: writing through it could land anywhere, so refuse (as for an entry
      // that cannot be checked). A plain entry is fine: its real path is its parent's plus its name. It shows up when it was created
      // between the two calls (a concurrent upload taking the same name), or when Windows briefly fails realpath on a busy file.
      const kind = await lstat(p).then(
        (s) => (s.isSymbolicLink() ? "link" : "plain"),
        (e: NodeJS.ErrnoException) => (e.code === "ENOENT" || e.code === "ENOTDIR" ? "missing" : "unknown"),
      );
      if (kind === "link" || kind === "unknown" || dirname(p) === p) return null;
      tail.unshift(basename(p));
    }
  }
}

export async function resolveInRoot(root: string, stored: unknown): Promise<PathResult> {
  try {
    const c = checkRelativePath(stored);
    if (!c.ok) return c;
    if (typeof root !== "string" || !isFullyAbsolute(root)) return fail("The files root is not a full path.");
    const rootAbs = resolve(root);
    const abs = resolve(rootAbs, ...c.path.split("/"));
    if (abs === rootAbs || !isInside(abs, rootAbs)) return refused;

    const [rReal, tReal] = [await realpath(rootAbs).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? ("missing" as const) : null)), await realTarget(abs)];
    if (rReal === "missing") return fail(ROOT_MISSING); // the lexical checks above already refused anything that escapes the root
    if (!rReal || !tReal || tReal === rReal || !isInside(tReal, rReal)) return refused; // symlink out of the root
    // A root that contains the app (e.g. home) must still not reach the project folder or the database folder.
    if ((await appDirs()).some((d) => isInside(tReal, d))) return refused;
    return { ok: true, path: abs };
  } catch {
    return refused;
  }
}
