// Server-only. Is the database behind the migrations in ./drizzle? A page or route that queries a table a pending migration would have created
// crashes with "no such table"; this lets the app say so calmly instead. "Pending" is what drizzle's own migrator would apply: journal entries
// newer (`when`) than the newest row in __drizzle_migrations. Existing data is never migrated here: the user presses "Back up and update"
// (lib/files/update.ts) or runs npm run db:migrate. The one exception is a brand-new database (no tables at all, so nothing to lose): the
// first check creates it by applying every migration. The journal is read once per process; an up-to-date answer is remembered per
// connection (migrations are never undone under a live connection, and a restore reopens it), while a "behind" answer is re-checked on
// every call (a single MAX query) so the page recovers by itself once the user has migrated.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "./client";

export const MIGRATIONS_FOLDER = "./drizzle";

// The one migrator (npm run db:migrate, the update button, a new database). Synchronous and all-or-nothing: drizzle's better-sqlite3
// migrator runs every pending migration between one BEGIN and COMMIT and rolls back on the first error, so a failing migration leaves
// the database as it was, and nothing else in this process can run (or see a half-updated schema) while it works.
export const applyMigrations = (folder: string = MIGRATIONS_FOLDER) => migrate(getDb(), { migrationsFolder: folder });

// Only same-site paths (no scheme, no "//host"), so the redirect after the update cannot leave the app.
export const safeReturnPath = (v: unknown): string =>
  typeof v === "string" && /^\/[\w\-/]*$/.test(v) && !v.startsWith("//") ? v : "/";

let journal: number[] | undefined; // the `when` of each migration the app ships
let upToDateFor: object | undefined;

export function pendingMigrations(): number {
  const db = getDb();
  if (upToDateFor === db) return 0;
  journal ??= readJournal();
  let applied = 0;
  try {
    applied =
      (
        db.$client.prepare("SELECT max(created_at) AS latest FROM __drizzle_migrations").get() as {
          latest: number | null;
        }
      ).latest ?? 0;
  } catch (e) {
    if (!/no such table/.test((e as Error).message)) throw e; // no migrations table: nothing applied yet
    const tables = (
      db.$client.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }
    ).n;
    if (tables === 0 && journal.length > 0) {
      // brand new: nothing to lose, so no page and no backup
      applyMigrations();
      upToDateFor = db;
      return 0;
    }
  }
  const pending = journal.filter((when) => when > applied).length;
  if (pending === 0) upToDateFor = db;
  return pending;
}

// An unreadable journal (app started outside the project folder, file removed) means "unknown": warn once and don't block
// every page over it; a page that hits a missing table still fails as it did before this check existed.
function readJournal(): number[] {
  const path = resolve(/*turbopackIgnore: true*/ "drizzle/meta/_journal.json");
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { entries: { when: number }[] }).entries.map((e) => e.when);
  } catch (e) {
    console.error(
      `Dossier could not read ${path} (${(e as Error).message}), so it cannot tell whether the database needs updating. Start Dossier from the project folder.`,
    );
    return [];
  }
}

export const UPDATE_TITLE = "Your database needs updating";
export const UPDATE_STEPS = [
  "Stop the Dossier server.",
  "Back up your data: copy the database file (data/dossier.db unless you set DATABASE_PATH) somewhere safe.",
  "Run npm run db:migrate.",
  "Start the server again.",
];
export const updateIntro = (pending: number) =>
  `This copy of Dossier expects ${pending} database ${pending === 1 ? "update" : "updates"} that ${pending === 1 ? "has" : "have"} not been applied yet. Nothing was changed and none of your data is lost. Dossier updates the database only when you ask it to.`;

// For the API routes: null when the database is current, otherwise a 503 with the same words as the page.
export function databaseUpdateResponse(): Response | null {
  const pending = pendingMigrations();
  if (pending === 0) return null;
  return Response.json(
    {
      error: `${UPDATE_TITLE}. ${updateIntro(pending)} Open Dossier in your browser and choose Back up and update, or in a terminal: ${UPDATE_STEPS.join(" ")}`,
    },
    { status: 503, headers: { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" } },
  );
}
