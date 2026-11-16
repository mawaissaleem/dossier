// Server-only. Is the database behind the migrations in ./drizzle? A page or route that queries a table a pending migration would have created
// crashes with "no such table"; this lets the app say so calmly instead. It never migrates: that stays an explicit step (npm run db:migrate)
// so the user takes a backup first. "Pending" is what drizzle's own migrator would apply: journal entries newer (`when`) than the newest row
// in __drizzle_migrations. A brand-new empty file has no such table, so everything is pending. The journal is read once per process; an
// up-to-date answer is remembered per connection (migrations are never undone under a live connection, and a restore reopens it), while a
// "behind" answer is re-checked on every call (a single MAX query) so the page recovers by itself once the user has migrated.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "./client";

let journal: number[] | undefined; // the `when` of each migration the app ships
let upToDateFor: object | undefined;

export function pendingMigrations(): number {
  const db = getDb();
  if (upToDateFor === db) return 0;
  journal ??= readJournal();
  let applied = 0;
  try {
    applied = (db.$client.prepare("SELECT max(created_at) AS latest FROM __drizzle_migrations").get() as { latest: number | null }).latest ?? 0;
  } catch (e) {
    if (!/no such table/.test((e as Error).message)) throw e; // an empty database: nothing applied yet
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
    console.error(`Dossier could not read ${path} (${(e as Error).message}), so it cannot tell whether the database needs updating. Start Dossier from the project folder.`);
    return [];
  }
}

export const UPDATE_TITLE = "Your database needs updating";
export const UPDATE_STEPS = [
  "Stop the Dossier server.",
  "Back up your data: copy the database file (data/dossier.db unless you set DATABASE_PATH) somewhere safe.",
  "Run npm run db:migrate.",
  "Run npm run db:seed too if this is a brand-new database.",
  "Start the server again.",
];
export const updateIntro = (pending: number) =>
  `This copy of Dossier expects ${pending} database ${pending === 1 ? "update" : "updates"} that ${pending === 1 ? "has" : "have"} not been applied yet. Nothing was changed and none of your data is lost. Dossier does not update the database by itself.`;

// For the API routes: null when the database is current, otherwise a 503 with the same words as the page.
export function databaseUpdateResponse(): Response | null {
  const pending = pendingMigrations();
  if (pending === 0) return null;
  return Response.json({ error: `${UPDATE_TITLE}. ${updateIntro(pending)} ${UPDATE_STEPS.join(" ")}` }, { status: 503, headers: { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" } });
}
