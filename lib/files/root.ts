// Server-only. All file-system access lives under /lib/files (resolve.ts joins paths under the root).
import { randomBytes } from "node:crypto";
import { realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isFullyAbsolute } from "./relative";

export type FilesRootResult = { ok: true; path: string } | { ok: false; error: string };

const MAX_PATH = 4096;
const fail = (error: string): FilesRootResult => ({ ok: false, error });

export const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
};

const real = (p: string) => realpath(p).catch(() => resolve(p)); // the data dir may not exist yet

// Folders the archive must not live in: the project folder and the folder holding the database (data/ by default).
export async function appDirs(): Promise<string[]> {
  const dirs = [process.cwd(), resolve("data")];
  if (process.env.DATABASE_PATH) dirs.push(dirname(resolve(process.env.DATABASE_PATH)));
  return Promise.all(dirs.map(real));
}

// Stored value = the path as typed, normalised (resolve(): no trailing slash, no "." or ".."), NOT its realpath. A symlinked or
// re-mounted root keeps working and shows what the user typed. The checks below use the realpath, so a symlink into data/ is still refused.
export async function validateFilesRoot(input: unknown): Promise<FilesRootResult> {
  if (typeof input !== "string") return fail("Enter the full path of a folder.");
  const typed = input.trim();
  if (typed === "") return fail("Enter the full path of a folder.");
  if (typed.length > MAX_PATH) return fail("That path is too long.");
  if (typed.includes("\0")) return fail("That path contains an invalid character.");
  if (!isFullyAbsolute(typed)) return fail("Use the full path, such as /home/you/Dossier or C:\\Users\\you\\Dossier. Relative paths and ~ are not accepted.");
  const path = resolve(typed);

  let st;
  try {
    st = await stat(path); // follows symlinks
  } catch {
    return fail("That folder does not exist. Create it first, then save.");
  }
  if (!st.isDirectory()) return fail("That path is a file, not a folder.");

  const target = await real(path);
  if ((await appDirs()).some((d) => isInside(target, d))) {
    return fail("Choose a folder outside the Dossier app folder and its data folder, so your files stay apart from the app's own.");
  }

  // Creating a file is the only reliable writability test (access(W_OK) ignores read-only mounts and ACLs).
  const probe = resolve(path, `.dossier-probe-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(probe, "", { flag: "wx" });
  } catch {
    return fail("Dossier cannot write to that folder. Check its permissions.");
  }
  await rm(probe, { force: true }).catch(() => {});
  return { ok: true, path };
}
