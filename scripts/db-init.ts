// Creates the empty SQLite file at DATABASE_PATH by opening it through the connection module.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
// Dynamic import so DATABASE_PATH is loaded before the module reads it.
import("../lib/db/client").then(({ db }) => {
  db.run("PRAGMA user_version = 0"); // forces the file to be written to disk (a bare open is lazy)
  console.log(`Database ready at ${process.env.DATABASE_PATH}`);
});
