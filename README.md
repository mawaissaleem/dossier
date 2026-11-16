# Dossier

Dossier is a single-user app for tracking job and PhD applications. It keeps the exact files you sent to each application, so you can find them again later.

Everything stays on your computer. There are no accounts, no cloud and no telemetry.

## First run (cold start)

You need:

- **Node.js 20.9 or newer** (Next.js 16 needs at least 20.9) and npm. Use an even-numbered release, 20 LTS or 22 LTS: the database library (`better-sqlite3`) does not support odd-numbered Node versions. CI uses Node 20.
- A normal install downloads a ready-made binary for the database library (`better-sqlite3`). If your platform has none, `npm ci` builds it, and that needs Python 3 and a C++ compiler.

From a fresh clone, in the project folder:

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run build
npm run start
```

Then open <http://127.0.0.1:3000>. If `localhost` works for you, it is fine too.

- `npm run db:migrate` creates the database file and applies the schema. It is safe to repeat.
- `npm run db:seed` adds the Job and PhD tracks. It does nothing if they already exist.
- `npm run build` and `npm run start` are for daily use. For development use `npm run dev` instead.
- To use another port, add `-- -p 4000`, for example `npm run start -- -p 4000`.

### The `.env` file

The repository ships a `.env` file with two lines:

```
NEXT_TELEMETRY_DISABLED=1
DATABASE_PATH=./data/dossier.db
```

`DATABASE_PATH` is the only setting Dossier reads. It is where the database file lives. A relative path is resolved from the folder you start the app in, so always run the npm commands from the project folder.

To keep the database somewhere else, do not edit `.env`. Create a file named `.env.local` in the project folder (git ignores it) with your own value, for example:

```
DATABASE_PATH=/path/to/dossier-data/dossier.db
```

Use a full path. Run `npm run db:migrate` and `npm run db:seed` again after you change it, because that is a new, empty database.

## Localhost only

Dossier must only answer on your own computer. Start it with the npm scripts (`npm run start` or `npm run dev`). They bind to `127.0.0.1`.

Do not run `next start` or `next dev` directly. Without the `-H 127.0.0.1` flag they listen on every network interface, so other devices on your network could reach your data.

As a second guard, every request must carry a `localhost`, `127.0.0.1` or `[::1]` Host name. Anything else gets `Forbidden: Dossier answers on localhost only.`

## Where your data lives

| What | Where |
| --- | --- |
| Database | The file in `DATABASE_PATH`. Default: `data/dossier.db` inside the project folder (git ignores `data/`). |
| Files root | The folder where your uploaded files are kept. It has **no default**. You choose it in the app: **Settings → Files**. Until you do, uploads are refused. |
| Backups | The folder you choose in **Settings → Backup**. It has no default either. |

The files root and the backup folder are stored in the database, not in `.env`. Both must be existing folders given as a full path, outside the project folder and outside the folder that holds the database.

How files are stored:

- Each application gets its own folder in the files root, named from its first upload. A Job application uses `Company_Role_YYYY-MM`, a PhD application uses `University_Program_YYYY-MM`. If those values are empty, the application title is used. Renaming the company later does not move anything.
- Each file is renamed `NN-YYYYMMDD-name.ext`, for example `01-20261115-cv.pdf`. `NN` counts up per name, date and extension, so an older file is never overwritten.
- Your original file is copied, never changed. Stored files are set to read-only. The limit is 50 MB per upload.
- The same file (same checksum) is not stored twice for one application.

## Backup and restore

Open **Settings → Backup**.

**Back up now** writes one zip into your backup folder. The name is `dossier-backup-YYYYMMDD-HHMM.zip`. A backup never overwrites an earlier one. The zip holds:

- `manifest.json` (date, schema version, file counts),
- `database/dossier.db` (a consistent copy of the database),
- `files/...` (every file in your files root, with the same relative paths).

**Reminder.** A banner on every page tells you when the last backup is older than the reminder interval (default 7 days, you can set 1 to 365). It also shows if you have applications and have never backed up. Set the interval in **Settings → Backup**.

**Restore from a zip.** One backup file rebuilds the whole app.

1. In **Settings → Backup**, type the full path of the zip and press **Check backup**. Dossier reads it and verifies every file. Nothing changes yet.
2. Press **Restore…**. The dialog says what you will lose and what replaces it.
3. Dossier first saves a safety backup of your current data into your backup folder. If that fails, nothing is changed. A restore needs a saved backup folder for this reason.
4. Then it replaces the database and the contents of your files root with the backup's. Keep only Dossier files in the files root: anything else there is removed by a restore.

What a restore keeps on this computer: the files root path, the backup folder, the reminder interval and the last backup time. To undo a restore, restore the safety backup.

On a new computer, set the files root and the backup folder in Settings first. Then restore.

**CSV export.** Open a track and press **Export CSV**. It saves every application in that track, including archived ones, as `dossier-<track>-YYYYMMDD.csv`. This is for reading in a spreadsheet. It is not a backup.

**Manual fallback.** Stop the server, then copy the database file and the whole files root to a safe place. To go back, stop the server and copy them back. Copy the database file only while the server is stopped.

## Moving the files folder

In **Settings → Files**, once files are stored, a new folder has two options:

- **Move files…** Dossier moves the files into the new folder, which must be empty and exist already. You confirm first. Files on the same drive are renamed. Otherwise each is copied, checked against its checksum, and the old copy is removed.
- **Re-point** is for a folder you already moved yourself. Dossier saves the new path only if every stored file is there. A file whose size differs from the record is accepted and flagged as changed. If any file is missing, nothing is saved.

A plain **Save** of a different folder is refused, so no file is lost track of.

If you moved the folder by hand and did not Re-point, opening a file shows `The files folder was not found. If you moved it, use Re-point in Settings.` Use Re-point with the new path.

## Updating

First take a backup while the server is still running: use **Back up now** in Settings. Then stop the server. (Or stop the server first and copy the database file, `data/dossier.db` unless you changed `DATABASE_PATH`, and the files root somewhere safe.) Only then update:

```bash
git pull
npm ci
npm run db:migrate
npm run build
```

Then start the server again with `npm run start`. If you start a newer version before running `npm run db:migrate`, every page says "Your database needs updating" instead of failing; nothing is migrated by itself.

## Troubleshooting

- **`Forbidden: Dossier answers on localhost only.`** You opened Dossier with a name other than `localhost`, `127.0.0.1` or `[::1]` (for example a computer name or a proxy). Use `http://127.0.0.1:3000`.
- **`EADDRINUSE: address already in use`** Something already uses the port, often an old Dossier. Stop it, or start on another port: `npm run start -- -p 4000`.
- **`DATABASE_PATH is not set`** The `.env` file is missing or you started the app from another folder. Run it from the project folder, or set `DATABASE_PATH` in `.env.local`.
- **`Your database needs updating`** on every page. The database is behind this version of Dossier (a new version added migrations, or the database file is new and empty). Nothing was changed and nothing is lost. Stop the server, copy the database file somewhere safe, run `npm run db:migrate` (and `npm run db:seed` if the database is new), then start the server again. API requests answer `503` with the same message until then.
- **`no such table: tracks`, or no tracks in the app.** The database is new or not migrated. Run `npm run db:migrate`, then `npm run db:seed`.
- **`Choose the files folder in Settings before uploading.`** Set the files root in **Settings → Files**.
- **A file shows `Changed since upload` or `Missing`.** The file on disk is not the one that was stored. It was edited, replaced or deleted outside Dossier. On the application page press **Check files** to recheck every file. A changed file can still be opened from the warning page with **Open anyway**.
- **`The files folder was not found. If you moved it, use Re-point in Settings.`** See "Moving the files folder". If the drive is just not mounted, mount it and try again.
- **A backup is refused.** The backup folder must exist, be writable, and be outside the project folder, the database folder and the files root.

## Development

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run lint`: ESLint
- `npx next typegen && npx tsc --noEmit`: type check (typegen creates route types; needed on a fresh clone)
- `npm test`: run Vitest once (temporary databases only; `npm run test:watch` to watch)
- `npm run db:migrate`: apply `./drizzle` migrations to `DATABASE_PATH`
- `npm run db:seed`: seed the Job and PhD tracks (idempotent)
- `npm run db:seed:fake -- --count 500`: add fake applications to a scratch database for performance and search checks (run `db:seed` first; options `--mix Job=80,PhD=20`, `--seed`, `--base`; each run adds another batch; refuses `./data/dossier.db` unless `--force`)
- `npm run db:generate`: generate a migration after editing `lib/db/schema.ts`

Tests never touch `data/`. They create temporary databases.

More documents (these are kept by the author and are not in the git repository): `WORKFLOW.md` (how the coding agents work), `DESIGN.md` (UI rules and themes), and the requirements specification and build plan (`Application Tracker ... .md`).
