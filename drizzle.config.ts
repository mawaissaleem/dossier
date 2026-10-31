import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_PATH) {
  throw new Error("DATABASE_PATH is not set. Add it to .env or .env.local.");
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts", // created in task 0.3
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_PATH },
});
