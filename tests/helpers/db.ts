import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { closeDb, getDb } from "@/lib/db/client";

let dir: string | undefined;

// Fresh migrated SQLite file in the OS temp dir, never the project's data/. Call in beforeEach; pair with dropTestDb in afterEach.
export function useTestDb() {
  dropTestDb();
  dir = mkdtempSync(join(tmpdir(), "dossier-test-"));
  process.env.DATABASE_PATH = join(dir, "test.db");
  migrate(getDb(), { migrationsFolder: "./drizzle" });
  return getDb();
}

export function dropTestDb() {
  closeDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
}

// Runs the real scripts/seed.ts against the current test DB (it reads DATABASE_PATH from the env we pass).
export function runSeed() {
  if (!dir) throw new Error("useTestDb() first");
  execFileSync(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/seed.ts"], {
    env: { ...process.env, DATABASE_PATH: join(dir, "test.db") },
    stdio: "pipe",
  });
}
