// Server-only: never import from client components. The only file that knows about better-sqlite3 (NFR-6).
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

function open() {
  const path = process.env.DATABASE_PATH;
  if (!path) {
    throw new Error("DATABASE_PATH is not set. Add it to .env (default: DATABASE_PATH=./data/dossier.db) or .env.local.");
  }
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON"); // SQLite ignores FKs (and cascades) unless set per connection
  return drizzle(sqlite);
}

// Opened on first call, not on import: `next build` imports route modules and must not create or need the DB file.
// Cached on globalThis so dev hot reload does not re-open the file on every edit.
const g = globalThis as unknown as { __dossierDb?: ReturnType<typeof open> };
export const getDb = () => (g.__dossierDb ??= open());

// Closes and forgets the cached handle. Tests use it between files; Phase 8 restore will need it too.
export function closeDb() {
  g.__dossierDb?.$client.close();
  delete g.__dossierDb;
}
