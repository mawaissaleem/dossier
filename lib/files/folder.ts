// Server-only. Creates an application's folder under the files root on its first upload (5.7 calls this; nothing else does).
// Stable: an application that already has files keeps its folder (read from the stored paths), so renaming the company moves nothing.
// Otherwise the name comes from the pure rule in lib/folder-name.ts, made unique against other applications' folders (DB) and against
// whatever already sits in the root (a manually dropped folder, FR-5.11). Limit: only top-level root entries are compared, because
// our folders are always one segment deep.
import { mkdir, readdir, stat } from "node:fs/promises";
import { folderBaseName, uniqueFolderName } from "../folder-name";
import { getFolderNameData, getApplicationFolder, getUsedFolders } from "../db/files";
import { getFilesRoot } from "../db/settings";
import { resolveInRoot } from "./resolve";

export type FolderResult = { ok: true; relativePath: string; absolutePath: string } | { ok: false; error: string };
const fail = (error: string): FolderResult => ({ ok: false, error });
const MAX_TRIES = 1000;

// uploadDate (YYYY-MM-DD) is only used when the application has no folder yet.
export async function ensureApplicationFolder(applicationId: number, uploadDate: string): Promise<FolderResult> {
  const root = await getFilesRoot();
  if (!root) return fail("Choose the files folder in Settings before uploading.");

  const existing = await getApplicationFolder(applicationId);
  if (existing) {
    const r = await resolveInRoot(root, existing);
    if (!r.ok) return fail(r.error);
    try {
      await mkdir(r.path); // recreate if the user removed it
    } catch (e) {
      const isDir = await stat(r.path).then((st) => st.isDirectory(), () => false);
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !isDir) return fail("Could not create the application folder.");
    }
    return { ok: true, relativePath: existing, absolutePath: r.path };
  }

  const data = await getFolderNameData(applicationId);
  if (!data) return fail("Application not found.");
  let base: string;
  try {
    base = folderBaseName({ id: applicationId, ...data, uploadDate });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid upload date.");
  }
  let onDisk: string[];
  try {
    onDisk = await readdir(root);
  } catch {
    return fail("The files folder cannot be read. Check it in Settings.");
  }
  const taken = new Set([...(await getUsedFolders(applicationId)), ...onDisk]);
  for (let i = 0; i < MAX_TRIES; i++) {
    const name = uniqueFolderName(base, taken);
    const r = await resolveInRoot(root, name);
    if (!r.ok) return fail(r.error);
    try {
      await mkdir(r.path); // not recursive: EEXIST means we lost a race, so pick the next name
      return { ok: true, relativePath: name, absolutePath: r.path };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return fail("Could not create the application folder.");
      taken.add(name);
    }
  }
  return fail("Could not find a free folder name.");
}
