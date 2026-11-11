import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backUpNow, restoreBackup } from "@/app/actions/backup";
import { addSubmission } from "@/app/actions/submissions";
import { createApplication } from "@/lib/db/applications";
import { getBackupDestination, getLastBackupAt, getReminderDays, REMINDER_DAYS_KEY, setBackupDestination, setReminderDays } from "@/lib/db/backup";
import { getDb } from "@/lib/db/client";
import { addNote } from "@/lib/db/notes";
import * as dbRestore from "@/lib/db/restore";
import { applications, columns, tracks } from "@/lib/db/schema";
import { getFilesRoot, getSetting, setFilesRoot } from "@/lib/db/settings";
import { createBackup } from "@/lib/files/backup";
import { checkBackup, restoreFromBackup } from "@/lib/files/restore";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";
import { readZip, rewriteZip, writeZip, type ZipSpec } from "./helpers/zip";

vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const TABLES = ["tracks", "columns", "column_options", "applications", "cell_values", "files", "submissions", "submission_files", "notes", "activity_events"];
let work: string, root: string, dest: string, good: string;
let db: ReturnType<typeof useTestDb>;

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
function walk(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) Object.assign(out, walk(p, `${prefix}${n}/`));
    else out[prefix + n] = sha(p);
  }
  return out;
}
// Everything a restore may change, so "nothing changed" is one toEqual.
const snapshot = (withSettings = false) => ({
  tables: Object.fromEntries([...TABLES, ...(withSettings ? ["settings"] : [])].map((t) => [t, getDb().$client.prepare(`SELECT * FROM ${t} ORDER BY id`).all()])),
  files: walk(root),
  dbFolder: readdirSync(dirname(process.env.DATABASE_PATH!)),
  backups: existsSync(dest) ? readdirSync(dest) : null,
});

async function populate() {
  const trackId = db.select().from(tracks).all().find((t) => t.name === "Job")!.id;
  const company = db.select().from(columns).all().find((c) => c.trackId === trackId && c.name === "Company")!.id;
  const ids: number[] = [];
  for (const title of ["Acme Robotics", "Beta Labs"]) {
    const r = await createApplication({ title, trackId, values: [{ columnId: company, value: `${title} Inc` }] });
    if (!r.ok) throw new Error(r.error);
    ids.push(r.id);
  }
  const up = async (name: string, content: string, appId = ids[0]) => {
    const r = await storeUploadedFile({ applicationId: appId, file: new File([content], name), label: "CV", uploadDate: "2026-11-08" });
    if (!r.ok || !("file" in r)) throw new Error(JSON.stringify(r));
    return r.file;
  };
  const cv = await up("CV.pdf", "cv version 1");
  await up("Letter.txt", "dear sirs");
  await up("CV.pdf", "beta cv", ids[1]);
  expect(await addSubmission(ids[0], [cv.id], "2026-11-08", "sent", null)).toEqual({ ok: true });
  expect((await addNote(ids[0], "called them")).ok).toBe(true);
  return ids;
}

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  work = mkdtempSync(join(tmpdir(), "dossier-rst-"));
  root = join(work, "files");
  dest = join(work, "out");
  mkdirSync(root);
  mkdirSync(dest);
  await setFilesRoot(root);
  await setBackupDestination(dest);
  await setReminderDays(7);
  await populate();
  const b = await createBackup(dest, new Date(2026, 10, 9, 10, 0));
  if (!b.ok) throw new Error(b.error);
  good = join(work, "good.zip");
  cpSync(b.path, good);
  rmSync(b.path); // the backup folder starts empty, so a safety backup is easy to spot
});
afterEach(() => {
  vi.restoreAllMocks();
  dropTestDb();
  rmSync(work, { recursive: true, force: true });
});

const createdAt = () => new Date(2026, 10, 9, 10, 0).toISOString();
const restore = (zip = good) => restoreFromBackup(zip, { createdAt: createdAt(), counts: dbRestore.currentCounts() });
const wipe = () => {
  getDb().delete(applications).run();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root);
  writeFileSync(join(root, "junk.txt"), "not in the backup");
};
// A variant of the good zip. `files/` entries may be changed; the manifest is recomputed unless `keepManifest`.
function craft(name: string, change: (m: Map<string, Buffer>) => void, extra: ZipSpec[] = [], keepManifest = false) {
  const out = join(work, name);
  rewriteZip(good, out, (m) => {
    change(m);
    if (keepManifest) return;
    const files = [...m].filter(([n]) => n.startsWith("files/"));
    m.set("manifest.json", Buffer.from(JSON.stringify({ ...JSON.parse(m.get("manifest.json")!.toString()), fileCount: files.length, filesBytes: files.reduce((s, [, d]) => s + d.length, 0) })));
  }, extra);
  return out;
}
async function refused(zip: string, re: RegExp, alsoCheck = true) {
  const before = snapshot(true);
  const r = await restore(zip);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error).toMatch(re);
  expect(snapshot(true)).toEqual(before); // nothing changed: rows, settings, files, no staging, no safety backup
  if (!alsoCheck) return; // refusals that depend on this computer's settings only apply to a restore
  const c = await checkBackup(zip);
  expect(!c.ok && c.error).toMatch(re);
}

describe("AT-13: back up, wipe, restore", () => {
  it("brings back applications, columns, files, submissions and notes; files match their hashes and are read-only", async () => {
    const before = snapshot();
    expect(before.files).not.toEqual({});
    wipe();
    await setReminderDays(3); // this computer's setting: must survive
    expect(snapshot().tables.applications).toEqual([]);

    const c = await checkBackup(good);
    expect(c).toMatchObject({ ok: true, info: { createdAt: createdAt(), fileCount: 3, extraFiles: 0, schemaOlder: false, counts: { applications: 2, files: 3, submissions: 1, notes: 1 } } });

    const r = await restore();
    expect(r).toMatchObject({ ok: true, createdAt: createdAt(), counts: { applications: 2, files: 3, submissions: 1, notes: 1 }, warnings: [] });
    const after = snapshot();
    expect(after.tables).toEqual(before.tables);
    expect(after.files).toEqual(before.files); // same paths, same hashes; the junk file is gone
    for (const rel of Object.keys(after.files)) expect(statSync(join(root, rel)).mode & 0o222).toBe(0);
    for (const row of getDb().$client.prepare("SELECT relative_path, sha256 FROM files").all() as { relative_path: string; sha256: string }[]) {
      expect(sha(join(root, row.relative_path))).toBe(row.sha256);
    }
    expect(existsSync(join(root, "junk.txt"))).toBe(false);
    expect(after.dbFolder).toEqual(before.dbFolder); // no staging or old-copy leftovers
  });

  it("takes a safety backup of the current state first, in the saved folder, and names it", async () => {
    wipe();
    const r = await restore();
    expect(r.ok && r.safetyBackupPath).toMatch(/dossier-backup-\d{8}-\d{4}\.zip$/);
    if (!r.ok) return;
    expect(readdirSync(dest)).toEqual([r.safetyBackupPath.split("/").pop()]);
    const z = readZip(r.safetyBackupPath);
    // exactly the state before the restore: the junk file, and not the staged copy of the incoming backup
    expect([...z.keys()].filter((n) => n.startsWith("files/"))).toEqual(["files/junk.txt"]);
    const copy = join(work, "safety.db");
    writeFileSync(copy, z.get("database/dossier.db")!);
    const c = new Database(copy, { readonly: true });
    expect(c.prepare("SELECT count(*) AS n FROM applications").get()).toEqual({ n: 0 });
    c.close();
  });

  it("keeps this computer's settings and drops the backup's (files root, backup folder, reminder, last backup)", async () => {
    await setReminderDays(3);
    getDb().$client.prepare("DELETE FROM settings WHERE key = 'files_root'").run();
    const other = join(work, "other-root");
    mkdirSync(other);
    await setFilesRoot(other);
    // the zip's files root is `root`, but the files go to the configured one
    const r = await restore();
    expect(r.ok).toBe(true);
    expect(await getFilesRoot()).toBe(other);
    expect(await getBackupDestination()).toBe(dest);
    expect(await getReminderDays()).toBe(3);
    expect(await getLastBackupAt()).not.toBeNull(); // the safety backup's time, kept
    expect(Object.keys(walk(other))).toHaveLength(3); // the files went to the configured folder
  });

  it("a setting that is unset here stays unset: the backup's value is not brought in", async () => {
    getDb().$client.prepare("DELETE FROM settings WHERE key = ?").run(REMINDER_DAYS_KEY);
    expect(await getSetting(REMINDER_DAYS_KEY)).toBeUndefined();
    expect((await restore()).ok).toBe(true); // the backup was made with 7
    expect(await getSetting(REMINDER_DAYS_KEY)).toBeUndefined();
  });

  it("restores a backup with no files and leaves the files folder as it is", async () => {
    getDb().$client.prepare("DELETE FROM submissions").run();
    getDb().$client.prepare("DELETE FROM files").run(); // a database with no file rows
    const b = await createBackup(dest, new Date(2026, 10, 9, 11, 0));
    if (!b.ok) throw new Error(b.error);
    const dbOnly = readZip(b.path).get("database/dossier.db")!;
    rmSync(b.path);
    const zip = craft("db-only.zip", (m) => { for (const n of [...m.keys()]) if (n.startsWith("files/")) m.delete(n); m.set("database/dossier.db", dbOnly); });
    writeFileSync(join(root, "keep-me.txt"), "left alone");
    const r = await restore(zip);
    expect(r).toMatchObject({ ok: true, counts: { files: 0, submissions: 0 } });
    expect(readFileSync(join(root, "keep-me.txt"), "utf8")).toBe("left alone");
  });

  it("restores an older-schema backup and migrates it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dossier-old-"));
    try {
      cpSync("./drizzle", join(dir, "old"), { recursive: true });
      const journalPath = join(dir, "old/meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.slice(0, 1);
      writeFileSync(journalPath, JSON.stringify(journal));
      const file = join(dir, "old.db");
      const old = new Database(file);
      migrate(drizzle(old), { migrationsFolder: join(dir, "old") });
      old.prepare("INSERT INTO tracks (user_id, name, position, created_at, updated_at) VALUES ('local', 'T', 0, 1, 1)").run();
      old.prepare("INSERT INTO applications (user_id, track_id, title, created_at, updated_at) VALUES ('local', 1, 'Old app', 1, 1)").run();
      old.close();
      const zip = craft("old.zip", (m) => { for (const n of [...m.keys()]) if (n.startsWith("files/")) m.delete(n); m.set("database/dossier.db", readFileSync(file)); });
      expect(await checkBackup(zip)).toMatchObject({ ok: true, info: { schemaOlder: true, counts: { applications: 1, files: 0, notes: 0 } } });
      const r = await restore(zip);
      expect(r.ok).toBe(true);
      expect(getDb().select().from(applications).all().map((a) => a.title)).toEqual(["Old app"]);
      expect(getDb().$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: 5 });
      expect((getDb().$client.prepare("PRAGMA table_info(files)").all() as { name: string }[]).map((c) => c.name)).toEqual(expect.arrayContaining(["integrity", "checked_at", "deleted_at"]));
      expect(getDb().$client.prepare("SELECT name FROM sqlite_master WHERE name = 'activity_events'").all()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores stray files the database does not list, and says so in the check", async () => {
    const zip = craft("extra.zip", (m) => m.set("files/stray/notes.txt", Buffer.from("stray")));
    expect(await checkBackup(zip)).toMatchObject({ ok: true, info: { fileCount: 4, extraFiles: 1 } });
    expect((await restore(zip)).ok).toBe(true);
    expect(readFileSync(join(root, "stray/notes.txt"), "utf8")).toBe("stray");
    expect(statSync(join(root, "stray/notes.txt")).mode & 0o222).toBe(0);
  });

  it("reads a backup that archiver itself wrote with a non-ASCII file name", async () => {
    mkdirSync(join(root, "Zürich"));
    writeFileSync(join(root, "Zürich", "Lebenslauf-é.txt"), "real");
    const b = await createBackup(dest, new Date(2026, 10, 9, 12, 0));
    if (!b.ok) throw new Error(b.error);
    expect(await checkBackup(b.path)).toMatchObject({ ok: true, info: { fileCount: 4, extraFiles: 1 } });
    wipe();
    const r = await restoreFromBackup(b.path, { createdAt: b.createdAt, counts: dbRestore.currentCounts() });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, "Zürich", "Lebenslauf-é.txt"), "utf8")).toBe("real");
  });

  it("restores a file name with non-ASCII characters", async () => {
    const zip = craft("unicode.zip", (m) => m.set("files/Zürich-2026/Lebenslauf-é.txt", Buffer.from("x")));
    expect((await restore(zip)).ok).toBe(true);
    expect(readFileSync(join(root, "Zürich-2026/Lebenslauf-é.txt"), "utf8")).toBe("x");
  });
});

describe("validation refuses before anything is changed", () => {
  const firstFile = () => [...readZip(good).keys()].find((n) => n.startsWith("files/") && n.endsWith("CV.pdf"))!;
  const letter = () => [...readZip(good).keys()].find((n) => n.endsWith("Letter.txt"))!;
  const withBackupEntries = (extra: ZipSpec[]) => {
    const out = join(work, "extra-entries.zip");
    const m = readZip(good);
    writeZip(out, [...[...m].map(([name, data]) => ({ name, data })), ...extra]);
    return out;
  };

  it.each([
    ["a .. name (zip-slip)", "files/../../evil.txt"],
    ["an absolute name", "/tmp/evil.txt"],
    ["a drive-letter name", "files/C:/evil.txt"],
    ["a backslash name", "files\\..\\evil.txt"],
    ["a NUL name", "files/a\0.txt"],
  ])("refuses %s", async (_l, name) => {
    await refused(withBackupEntries([{ name, data: "evil" }]), /unsafe name|outside its own folder/);
    expect(existsSync(join(work, "evil.txt"))).toBe(false);
  });

  it("refuses a duplicate name, a symlink, a folder with data, an unknown entry and an encrypted entry", async () => {
    await refused(withBackupEntries([{ name: firstFile(), data: "dup" }]), /twice/);
    await refused(withBackupEntries([{ name: "files/link", data: "/etc/passwd", mode: 0o120777 }]), /link or special/);
    await refused(withBackupEntries([{ name: "files/dir/", data: "x", mode: 0o040755 }]), /folder entry with data/);
    await refused(withBackupEntries([{ name: "run.sh", data: "x" }]), /unexpected entry/);
    await refused(withBackupEntries([{ name: "files/enc.bin", data: "x", flags: 0x801 }]), /readable zip|encrypted/); // yauzl itself refuses an encrypted entry
  });

  it("refuses oversized and bomb-like entries by their declared sizes", async () => {
    const big = (i: number): ZipSpec => ({ name: `files/big${i}.bin`, data: "x", declaredSize: 0xfffffff0, compressedSize: 0xfffffff0 });
    await refused(withBackupEntries([1, 2, 3, 4, 5, 6].map(big)), /unpack to more than/);
    await refused(withBackupEntries([{ name: "files/bomb.bin", data: "x", declaredSize: 50_000_000, compressedSize: 10, method: 8 }]), /zip bomb/);
  });

  it("refuses a bad manifest, an unsupported format version and a manifest that disagrees with the zip", async () => {
    await refused(craft("m1.zip", (m) => m.set("manifest.json", Buffer.from("not json")), [], true), /not an object/);
    const man = () => JSON.parse(readZip(good).get("manifest.json")!.toString());
    await refused(craft("m2.zip", (m) => m.set("manifest.json", Buffer.from(JSON.stringify({ ...man(), format: "other" }))), [], true), /not a Dossier backup/);
    await refused(craft("m3.zip", (m) => m.set("manifest.json", Buffer.from(JSON.stringify({ ...man(), formatVersion: 99 }))), [], true), /different version/);
    await refused(craft("m4.zip", (m) => m.set("manifest.json", Buffer.from(JSON.stringify({ ...man(), fileCount: 9 }))), [], true), /does not match its manifest/);
  });

  it("refuses a zip with no manifest, no database, a non-zip and a missing or relative path", async () => {
    await refused(craft("n1.zip", (m) => m.delete("manifest.json"), [], true), /no manifest/);
    await refused(craft("n2.zip", (m) => m.delete("database/dossier.db"), [], true), /no database/);
    writeFileSync(join(work, "text.zip"), "hello, I am not a zip");
    await refused(join(work, "text.zip"), /not a readable zip/);
    await refused(join(work, "nope.zip"), /No file exists/);
    await refused(work, /not a file/);
    await refused("relative/backup.zip", /full path/);
    await refused("", /full path/);
  });

  it("refuses a backup from a newer version of Dossier", async () => {
    const file = join(work, "newer.db");
    writeFileSync(file, readZip(good).get("database/dossier.db")!);
    const d = new Database(file);
    d.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', ?)").run(9_999_999_999_999);
    d.close();
    await refused(craft("newer.zip", (m) => m.set("database/dossier.db", readFileSync(file))), /newer version of Dossier/);
  });

  it("refuses a corrupt or foreign database", async () => {
    const db0 = readZip(good).get("database/dossier.db")!;
    await refused(craft("c1.zip", (m) => m.set("database/dossier.db", Buffer.from("garbage".repeat(500)))), /database inside the backup/);
    const damaged = Buffer.from(db0);
    for (let i = 4096; i < damaged.length; i += 17) damaged[i] ^= 0xff; // scribble over every page after the first
    await refused(craft("c2.zip", (m) => m.set("database/dossier.db", damaged)), /database inside the backup/);
    const other = join(work, "other.db");
    const o = new Database(other);
    o.exec("CREATE TABLE x (a)");
    o.close();
    await refused(craft("c3.zip", (m) => m.set("database/dossier.db", readFileSync(other))), /not a Dossier database/);
  });

  it("refuses a file whose bytes do not match the recorded SHA-256, and a listed file that is missing", async () => {
    await refused(craft("h1.zip", (m) => m.set(firstFile(), Buffer.from("cv version X"))), /not match the checksum.*CV\.pdf/);
    await refused(craft("h2.zip", (m) => m.delete(letter())), /missing from the zip.*Letter\.txt/);
  });

  it("refuses a zip that sits inside the files folder (a restore would delete it)", async () => {
    cpSync(good, join(root, "inside.zip"));
    await refused(join(root, "inside.zip"), /inside your files folder/);
  });

  it("refuses when the backup has files and no files folder is set, or the folder is unusable", async () => {
    getDb().$client.prepare("DELETE FROM settings WHERE key = 'files_root'").run();
    await refused(good, /no files folder is set/, false);
    await setFilesRoot(join(work, "gone"));
    await refused(good, /files folder cannot be used/, false);
  });

  it("refuses when the data or the backup changed since the confirmation", async () => {
    const stale = await restoreFromBackup(good, { createdAt: createdAt(), counts: { ...dbRestore.currentCounts(), applications: 99 } });
    expect(!stale.ok && stale.error).toMatch(/data changed since/);
    const other = await restoreFromBackup(good, { createdAt: "2020-01-01T00:00:00.000Z", counts: dbRestore.currentCounts() });
    expect(!other.ok && other.error).toMatch(/file changed since/);
    expect(await restoreFromBackup(good, null)).toMatchObject({ ok: false });
    expect(readdirSync(dest)).toEqual([]);
  });
});

describe("safety backup", () => {
  it("is required: with no saved backup folder nothing is changed", async () => {
    getDb().$client.prepare("DELETE FROM settings WHERE key = 'backup_destination'").run();
    wipe();
    const before = snapshot(true);
    const r = await restore();
    expect(!r.ok && r.error).toMatch(/Save a backup folder/);
    expect(snapshot(true)).toEqual(before);
  });

  it("failing stops the restore with the live data and the staging untouched", async () => {
    wipe();
    rmSync(dest, { recursive: true }); // the saved folder is gone: createBackup refuses
    const before = snapshot(true);
    const r = await restore();
    expect(!r.ok && r.error).toMatch(/Nothing was changed: the safety backup .* failed/);
    expect(snapshot(true)).toEqual(before);
  });
});

describe("a failure during the swap rolls everything back", () => {
  it("a database swap that fails puts the old files back", async () => {
    wipe();
    const before = snapshot(true);
    vi.spyOn(dbRestore, "swapDatabase").mockImplementation(() => { throw new Error("disk full"); });
    const r = await restore();
    expect(!r.ok && r.error).toMatch(/restore failed: disk full.*unchanged/);
    const after = snapshot(true);
    expect(after.backups).toHaveLength(1); // the safety backup stays
    const strip = (x: typeof before) => ({ ...x, backups: 0, tables: { ...x.tables, settings: x.tables.settings.filter((r) => (r as { key: string }).key !== "last_backup_at") } });
    expect(strip(after)).toEqual(strip(before));
    expect(existsSync(join(root, "junk.txt"))).toBe(true);
    expect(readdirSync(root)).toEqual(["junk.txt"]); // no staging or empty aside folder left behind
  });

  it("restored data that does not match the backup is rolled back, database and files", async () => {
    wipe();
    const before = snapshot();
    const real = dbRestore.currentCounts();
    let n = 0;
    vi.spyOn(dbRestore, "currentCounts").mockImplementation(() => (++n === 1 ? real : { ...real, applications: 999 }));
    const r = await restoreFromBackup(good, { createdAt: createdAt(), counts: real });
    expect(!r.ok && r.error).toMatch(/did not match the backup/);
    vi.restoreAllMocks();
    const after = snapshot();
    expect({ ...after, backups: 0 }).toEqual({ ...before, backups: 0 });
    expect(after.tables.applications).toEqual([]);
    expect(readdirSync(root)).toEqual(["junk.txt"]); // no staging or empty aside folder left behind
  });
});

describe("the action", () => {
  it("does not run while a backup is running, or twice at once, and revalidates every page", async () => {
    const { revalidatePath } = await import("next/cache");
    wipe();
    const counts = dbRestore.currentCounts();
    const first = restoreBackup(good, { createdAt: createdAt(), counts });
    expect(await backUpNow()).toMatchObject({ ok: false, error: /already running/ });
    expect(await restoreBackup(good, { createdAt: createdAt(), counts })).toMatchObject({ ok: false, error: /already running/ });
    expect((await first).ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect((await backUpNow()).ok).toBe(true); // the lock is released
  });
});
