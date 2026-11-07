// Server-only. Typed key-value access to the settings table (FR-13.5). Values are stored as JSON text.
import { and, eq } from "drizzle-orm";
import { getDb } from "./client";
import { settings } from "./schema";
import { getUserId } from "./user";

export const FILES_ROOT_KEY = "files_root";

// undefined = never set (or unreadable JSON, which is treated as unset rather than crashing the page).
export async function getSetting(key: string): Promise<unknown> {
  const row = getDb().select({ value: settings.value }).from(settings).where(and(eq(settings.userId, getUserId()), eq(settings.key, key))).get();
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Setting value is not JSON-serialisable.");
  // updatedAt is set by hand: $onUpdate does not run for onConflictDoUpdate.
  getDb().insert(settings).values({ userId: getUserId(), key, value: json })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value: json, updatedAt: new Date() } }).run();
}

export async function getFilesRoot(): Promise<string | null> {
  const v = await getSetting(FILES_ROOT_KEY);
  return typeof v === "string" && v !== "" ? v : null;
}

export const setFilesRoot = (path: string) => setSetting(FILES_ROOT_KEY, path);
