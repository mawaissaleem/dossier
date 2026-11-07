"use server";

import { refresh } from "next/cache";
import { setFilesRoot } from "@/lib/db/settings";
import { validateFilesRoot, type FilesRootResult } from "@/lib/files/root";

// Validate, then save; nothing is saved on error. Stored files are not moved (relocate is a later task).
export async function saveFilesRoot(input: string): Promise<FilesRootResult> {
  const r = await validateFilesRoot(input); // also rejects non-strings: this runs on any POST
  if (!r.ok) return r;
  try {
    await setFilesRoot(r.path);
  } catch {
    return { ok: false, error: "Could not save. Try again." };
  }
  refresh();
  return r;
}
