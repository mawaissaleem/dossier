// Applies ./drizzle migrations through the app's own connection (creates the DB file if missing).
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
async function main() {
  // Dynamic import so DATABASE_PATH is loaded before the module reads it.
  const { applyMigrations } = await import("../lib/db/migrations");
  applyMigrations();
  console.log(`Migrations applied to ${process.env.DATABASE_PATH}`);
}

main();
