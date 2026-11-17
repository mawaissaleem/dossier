# Architecture decisions

The stack is the one in `CLAUDE.md`. This file records decisions that deviate from, or settle, something in the SRS or the build plan. If it conflicts with the stack in `CLAUDE.md`, this file wins.

## Decisions

### 2026-11-17: the database is updated in the app, with a backup first (task DB.1)
User request. It refines the CLEAN.1 decision ("database needs updating" page and 503, no auto-migrate); it does not remove it.
- **Existing data is still never migrated by itself.** The gate page now has **Back up and update**: `updateDatabase` (`lib/files/update.ts`) copies the database with SQLite's backup API (`copyDatabaseTo`) to a safety backup, applies the pending migrations, and checks none are left. The copy goes to the saved backup folder if it passes the "Back up now" checks and can be written, else `backups/` next to the database file (`dossier-before-update-<UTC time>.db`, never overwriting). If the copy fails, nothing is migrated.
- **One migrator.** `applyMigrations` (`lib/db/migrations.ts`) is used by `npm run db:migrate`, the button and the new-database case. Drizzle's better-sqlite3 migrator runs all pending migrations between one `BEGIN` and `COMMIT` and rolls back on the first error, so a failing migration leaves the data as it was; the safety backup is for the user, not for undoing. The call is synchronous, so no other request runs during it.
- **Brand-new database** (no file, or a file with no tables at all) is created and fully migrated by the first `pendingMigrations()` check: nothing to lose, no page, no backup. A file that has tables but no migrations table still goes through the gate. The empty install then starts at "Add track" (TRK.1); `db:seed` stays optional.
- **What it relies on while updates are pending:** pages (`DatabaseGate`) and API routes (`databaseUpdateResponse`) are refused. Server actions are not gated (they are not pages), so the update action is reachable; a stale tab's action either fails on a missing table or column, or writes the old schema, which the migration carries forward. One update at a time per process (a `globalThis` flag; a second server on the same file is not guarded).
- After success the action sets a ten-minute `httpOnly` cookie with the backup path and redirects to the page the user was on (same-site paths only, else `/`); `app/updated-note.tsx` shows it with a Dismiss button.

### 2026-11-17: tracks are created, renamed, recoloured and deleted in the app (task TRK.1)
User ruling. It overrides **FR-1.1** ("the app ships with two starter tracks, Job and PhD") and **FR-1.10** ("creating new custom tracks beyond the two starters is deferred to v2"). The SRS and build plan are not edited.
- A new database has **no tracks**. Job and PhD are **templates** the user adds (`lib/track-templates.ts`, pure), together with a **Blank** template (one Status column). A template can be added more than once under different names.
- One code path builds a track: `insertTrackFromTemplate` in `lib/db/tracks.ts`. The Add track dialog and `npm run db:seed` (now optional, idempotent, creates Job and PhD) both use it, so the templates are exactly what the seed always created.
- Custom tracks are still data: columns and values stay in `columns` / `cell_values`; the only schema change is `tracks.color` (nullable palette token; null on tracks made before TRK.1, shown with a colour derived from the id).
- Deleting a track removes its rows (ON DELETE CASCADE) and its `track.<id>.*` settings in one transaction, after a confirm that states the counts and needs the typed name. Files on disk are **not** deleted.
- Existing databases are untouched: no migration renames or removes Job or PhD.
