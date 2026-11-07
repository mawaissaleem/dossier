// Pure string rules for a stored relative path (no fs, no DB). The stored form is canonical: forward slashes only, no leading or
// trailing slash, no empty, "." or ".." segments. Windows forms (drive letters, backslashes, UNC) are rejected on every OS so a
// database written on Linux stays valid on Windows. Percent-decoding is the CALLER's job (URLs, 5.10): "%2e%2e" here is just a
// harmless file name, and a decoded ".." is rejected.
import path, { relative, resolve, sep } from "node:path";

export type PathResult = { ok: true; path: string } | { ok: false; error: string };

const MAX_PATH = 4096;
const fail = (error: string): PathResult => ({ ok: false, error });

export function checkRelativePath(input: unknown): PathResult {
  if (typeof input !== "string" || input === "") return fail("The stored path is empty.");
  if (input.length > MAX_PATH) return fail("The stored path is too long.");
  if (input.includes("\0")) return fail("The stored path contains an invalid character.");
  if (input.includes("\\") || input.includes(":")) return fail("The stored path uses a Windows form (backslash or drive letter).");
  if (input.startsWith("/")) return fail("The stored path must be relative to the files root.");
  for (const seg of input.split("/")) {
    if (seg === "") return fail("The stored path has an empty segment.");
    if (seg === "." || seg === "..") return fail("The stored path has a . or .. segment.");
    // Windows drops trailing dots and spaces, so ".. " or "..." would act as "..".
    if (/[. ]$/.test(seg)) return fail("A segment of the stored path ends in a dot or space.");
  }
  return { ok: true, path: input };
}

// Absolute AND anchored: on Windows a drive-less "\foo" counts as absolute to node but resolves against the current drive.
export const isFullyAbsolute = (p: string, m: path.PlatformPath = path) =>
  m.isAbsolute(p) && (m.sep === "/" || /^([a-z]:[\\/]|\\\\)/i.test(p));

// Absolute path inside the root -> stored form. String-only: use resolveInRoot for anything that touches disk.
export function toRelativePath(root: string, abs: string): PathResult {
  const rel = relative(resolve(root), resolve(abs));
  if (rel === "") return fail("That is the files root itself, not a file.");
  return checkRelativePath(rel.split(sep).join("/")); // ".." / other-drive results fail the canonical check
}
