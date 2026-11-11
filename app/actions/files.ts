"use server";

import { refresh } from "next/cache";
import { checkApplicationFiles, type CheckFilesResult } from "@/lib/files/check";
import { isId } from "@/lib/ids";

// Runs on any POST, so the id is checked here. The Host allow-list is proxy.ts (it runs before server actions). refresh() re-renders the badges.
export async function checkFiles(applicationId: number): Promise<CheckFilesResult> {
  if (!isId(applicationId)) return { ok: false, error: "Application not found." };
  try {
    const r = await checkApplicationFiles(applicationId);
    if (r.ok) refresh();
    return r;
  } catch {
    return { ok: false, error: "The check failed. Try again." };
  }
}
