// Applies ./drizzle migrations through the app's own connection (creates the DB file if missing).
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
async function main() {
  // Dynamic import so DATABASE_PATH is loaded before the module reads it.
  const db = (await import("../lib/db/client")).getDb();
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`Migrations applied to ${process.env.DATABASE_PATH}`);
}

main();
