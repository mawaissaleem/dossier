import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { applyMigrations, pendingMigrations, safeReturnPath } from "@/lib/db/migrations";
import { setBackupDestination } from "@/lib/db/backup";
import { plannedBackupFolder, safetyBackupName, updateDatabase } from "@/lib/files/update";
import { MIGRATION_COUNT } from "./helpers/db";

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet, delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

let dir: string;
const dbFile = () => join(dir, "data", "test.db");
const NOW = new Date("2026-11-17T10:30:00Z");

beforeEach(() => {
  closeDb();
  dir = mkdtempSync(join(tmpdir(), "dossier-update-"));
  mkdirSync(join(dir, "data"));
  process.env.DATABASE_PATH = dbFile();
  cookieSet.mockClear();
});
afterEach(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// A copy of ./drizzle holding only the first `keep` migrations (the app as an older version shipped it), optionally
// plus one that fails.
function folder(keep: number, bad = false) {
  const out = join(dir, `migrations-${keep}${bad ? "-bad" : ""}`);
  mkdirSync(join(out, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.slice(0, keep);
  for (const e of journal.entries) cpSync(`drizzle/${e.tag}.sql`, join(out, `${e.tag}.sql`));
  if (bad) {
    journal.entries.push({
      idx: keep,
      version: "6",
      when: journal.entries[keep - 1].when + 1000,
      tag: "9999_bad",
      breakpoints: true,
    });
    writeFileSync(
      join(out, "9999_bad.sql"),
      "CREATE TABLE half_done (x integer);--> statement-breakpoint\nINSERT INTO no_such_table VALUES (1);",
    );
  }
  writeFileSync(join(out, "meta/_journal.json"), JSON.stringify(journal));
  return out;
}

// An old-schema database (migrations up to 0004) holding data.
function oldDb() {
  applyMigrations(folder(5));
  const now = Date.now();
  getDb()
    .$client.prepare(
      "INSERT INTO tracks (user_id, created_at, updated_at, name, position) VALUES ('local', ?, ?, 'Job', 0)",
    )
    .run(now, now);
  getDb()
    .$client.prepare(
      "INSERT INTO settings (user_id, created_at, updated_at, key, value) VALUES ('local', ?, ?, 'k', '\"v\"')",
    )
    .run(now, now);
}

const snapshot = () =>
  JSON.stringify([
    getDb().$client.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
    getDb().$client.prepare("SELECT * FROM tracks").all(),
    getDb().$client.prepare("SELECT * FROM settings").all(),
    getDb().$client.prepare("SELECT hash, created_at FROM __drizzle_migrations").all(),
  ]);

describe("Back up and update", () => {
  it("backs up first, migrates, keeps the data, and the backup opens with the old schema", async () => {
    oldDb();
    expect(pendingMigrations()).toBe(MIGRATION_COUNT - 5);
    const r = await updateDatabase({ now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backupPath).toBe(join(dir, "data", "backups", "dossier-before-update-2026-11-17T10-30-00.db"));
    expect(pendingMigrations()).toBe(0);
    expect(getDb().$client.prepare("SELECT name FROM tracks").all()).toEqual([{ name: "Job" }]);
    expect(getDb().$client.prepare("SELECT value FROM settings WHERE key = 'k'").get()).toEqual({ value: '"v"' });
    expect(getDb().$client.prepare("SELECT color FROM tracks").all()).toEqual([{ color: null }]); // the new column
    const copy = new Database(r.backupPath!, { readonly: true });
    expect(copy.prepare("SELECT name FROM tracks").all()).toEqual([{ name: "Job" }]);
    expect(copy.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: 5 });
    expect(() => copy.prepare("SELECT color FROM tracks").all()).toThrow(); // taken before migrating
    copy.close();
  });

  it("does nothing when no updates are pending", async () => {
    applyMigrations();
    expect(await updateDatabase()).toEqual({ ok: true, backupPath: null });
    expect(existsSync(join(dir, "data", "backups"))).toBe(false);
  });

  it("uses the saved backup folder when it is valid, and falls back to backups/ next to the database when not", async () => {
    oldDb();
    const saved = join(dir, "saved");
    mkdirSync(saved);
    await setBackupDestination(saved);
    expect(await plannedBackupFolder()).toBe(saved);
    const r = await updateDatabase({ now: NOW });
    expect(r.ok && r.backupPath).toBe(join(saved, safetyBackupName(NOW)));
    expect(existsSync(join(saved, safetyBackupName(NOW)))).toBe(true);

    closeDb();
    rmSync(dbFile());
    oldDb();
    await setBackupDestination(join(dir, "gone")); // does not exist
    expect(await plannedBackupFolder()).toBe(join(dir, "data", "backups"));
  });

  it("never overwrites an earlier safety backup with the same name", async () => {
    oldDb();
    mkdirSync(join(dir, "data", "backups"));
    writeFileSync(join(dir, "data", "backups", safetyBackupName(NOW)), "earlier");
    const r = await updateDatabase({ now: NOW });
    expect(r.ok && r.backupPath).toBe(join(dir, "data", "backups", safetyBackupName(NOW, 2)));
    expect(readFileSync(join(dir, "data", "backups", safetyBackupName(NOW)), "utf8")).toBe("earlier");
  });

  it("a backup that cannot be written stops everything: nothing is migrated", async () => {
    oldDb();
    writeFileSync(join(dir, "data", "backups"), "a file where the folder should be");
    const before = snapshot();
    const r = await updateDatabase({ now: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("could not save a backup");
    expect(r.error).toContain("Your data was not changed");
    expect(snapshot()).toBe(before);
    expect(pendingMigrations()).toBe(MIGRATION_COUNT - 5);
  });

  it("a failing migration leaves the database exactly as it was, and the error names the backup", async () => {
    oldDb();
    const before = snapshot();
    const r = await updateDatabase({ now: NOW, migrationsFolder: folder(MIGRATION_COUNT, true) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const backup = join(dir, "data", "backups", safetyBackupName(NOW));
    expect(r.error).toContain("no_such_table");
    expect(r.error).toContain("Your data was not changed");
    expect(r.error).toContain(backup);
    expect(existsSync(backup)).toBe(true);
    // all-or-nothing: the migrations before the bad one were rolled back too, no half_done table
    expect(snapshot()).toBe(before);
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'half_done'").get()).toEqual({
      n: 0,
    });
  });

  it("a double submit runs once", async () => {
    oldDb();
    const [a, b] = await Promise.all([updateDatabase({ now: NOW }), updateDatabase({ now: NOW })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(readdirSync(join(dir, "data", "backups"))).toHaveLength(1);
    expect(pendingMigrations()).toBe(0);
    expect(await updateDatabase()).toEqual({ ok: true, backupPath: null }); // and the guard is released
  });
});

describe("the update action", () => {
  it("redirects to where the user was and leaves a one-shot note with the backup path", async () => {
    oldDb();
    const { backUpAndUpdate } = await import("@/app/actions/database");
    const form = new FormData();
    form.set("returnTo", "/tracks/1");
    await expect(backUpAndUpdate(null, form)).rejects.toThrow("REDIRECT /tracks/1");
    expect(cookieSet).toHaveBeenCalledWith(
      "dossier_updated",
      expect.stringContaining("dossier-before-update-"),
      expect.objectContaining({ maxAge: 600, httpOnly: true }),
    );
    expect(pendingMigrations()).toBe(0);
  });
  it("returns the error and sets no note when the update fails", async () => {
    oldDb();
    writeFileSync(join(dir, "data", "backups"), "x");
    const { backUpAndUpdate } = await import("@/app/actions/database");
    const r = await backUpAndUpdate(null, new FormData());
    expect(r?.error).toContain("Your data was not changed");
    expect(cookieSet).not.toHaveBeenCalled();
  });
  it("only same-site paths are followed", () => {
    expect(safeReturnPath("/planner")).toBe("/planner");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/a?b=c", null, 5])
      expect(safeReturnPath(bad)).toBe("/");
  });
});

describe("a brand-new database", () => {
  it("a missing file is created and migrated by the first check, with no gate", () => {
    expect(existsSync(dbFile())).toBe(false);
    expect(pendingMigrations()).toBe(0);
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({
      n: MIGRATION_COUNT,
    });
    // empty install: no tracks, no seed
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM tracks").get()).toEqual({ n: 0 });
  });
  it("an empty file (no tables) is migrated too", () => {
    writeFileSync(dbFile(), "");
    expect(pendingMigrations()).toBe(0);
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM tracks").get()).toEqual({ n: 0 });
  });
  it("existing data that is behind is never migrated by the check", () => {
    oldDb();
    expect(pendingMigrations()).toBe(MIGRATION_COUNT - 5);
    expect(pendingMigrations()).toBe(MIGRATION_COUNT - 5);
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: 5 });
  });
  it("a database with tables but no migrations table (not Dossier's own) is left alone", () => {
    getDb().$client.exec("CREATE TABLE something (x integer)");
    expect(pendingMigrations()).toBe(MIGRATION_COUNT);
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({
      n: 1,
    });
  });
});
