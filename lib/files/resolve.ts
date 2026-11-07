// Server-only. The one place that turns (files root, stored relative path) into an absolute path. Nothing else joins under the root.
// Limit: the check and the later open are separate steps, so a symlink swapped in between is not caught (single-user, local app).
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { appDirs, isInside } from "./root";
import { checkRelativePath, isFullyAbsolute, type PathResult } from "./relative";

const fail = (error: string): PathResult => ({ ok: false, error });
const refused = fail("That file path is not allowed.");

// Real path of the target, or of its nearest existing parent plus the not-yet-existing tail (files are created later).
async function realTarget(abs: string): Promise<string | null> {
  const tail: string[] = [];
  for (let p = abs; ; p = dirname(p)) {
    try {
      return join(await realpath(p), ...tail);
    } catch {
      // realpath failed. If the entry itself exists it is a dangling or looping symlink: writing through it could land anywhere.
      const exists = await lstat(p).then(() => true, (e: NodeJS.ErrnoException) => (e.code === "ENOENT" || e.code === "ENOTDIR" ? false : true));
      if (exists || dirname(p) === p) return null;
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

    const [rReal, tReal] = [await realpath(rootAbs).catch(() => null), await realTarget(abs)];
    if (!rReal || !tReal || tReal === rReal || !isInside(tReal, rReal)) return refused; // symlink out of the root
    // A root that contains the app (e.g. home) must still not reach the project folder or the database folder.
    if ((await appDirs()).some((d) => isInside(tReal, d))) return refused;
    return { ok: true, path: abs };
  } catch {
    return refused;
  }
}
