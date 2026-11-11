import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupFileName, buildManifest, parseManifest } from "@/lib/backup";
import { getLastBackupAt } from "@/lib/db/backup";
import { settings, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import * as dbBackup from "@/lib/db/backup";
import { createBackup } from "@/lib/files/backup";
import { dropTestDb, useTestDb } from "./helpers/db";
import { readZip } from "./helpers/zip";

describe("backup naming and manifest (pure)", () => {
  it("names the zip from local time and adds a counter after the first", () => {
    const d = new Date(2026, 10, 10, 14, 32);
    expect(backupFileName(d)).toBe("dossier-backup-20261110-1432.zip");
    expect(backupFileName(d, 2)).toBe("dossier-backup-20261110-1432-2.zip");
    expect(backupFileName(new Date(2026, 0, 2, 3, 4))).toBe("dossier-backup-20260102-0304.zip");
  });

  it("round-trips a manifest and rejects wrong ones", () => {
    const m = buildManifest({ createdAt: "2026-11-10T14:32:00.000Z", schema: { migrations: 3, latest: 123 }, filesRoot: null, fileCount: 0, filesBytes: 0 });
    expect(parseManifest(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, manifest: m });
    for (const bad of [null, "x", {}, { ...m, format: "other" }, { ...m, formatVersion: 2 }, { ...m, createdAt: "nope" }, { ...m, schema: null }, { ...m, fileCount: -1 }, { ...m, filesRoot: 5 }]) {
      expect(parseManifest(bad).ok).toBe(false);
    }
  });
});

let work: string, root: string, dest: string, db: ReturnType<typeof useTestDb>;
const sharedTmp = process.env.TMPDIR;
beforeEach(() => {
  db = useTestDb();
  work = mkdtempSync(join(tmpdir(), "dossier-bk-"));
  // a private temp folder, so the "no temp folder left" checks do not see other test files' backups running in parallel
  mkdirSync(join(work, "tmp"));
  process.env.TMPDIR = join(work, "tmp");
  root = join(work, "files");
  dest = join(work, "out");
  mkdirSync(join(root, "Acme-2026"), { recursive: true });
  mkdirSync(join(root, "Empty"));
  mkdirSync(dest);
  writeFileSync(join(root, "Acme-2026", "cv.pdf"), "cv bytes");
  writeFileSync(join(root, "Acme-2026", "letter.txt"), "hello");
  writeFileSync(join(root, "top.txt"), "t");
  chmodSync(join(root, "Acme-2026", "cv.pdf"), 0o444); // stored files are read-only
});
afterEach(() => {
  if (sharedTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = sharedTmp;
  vi.restoreAllMocks();
  dropTestDb();
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 10, 10, 14, 32);
const ok = async (d = dest, now = NOW) => {
  const r = await createBackup(d, now);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const err = async (d: unknown) => {
  const r = await createBackup(d, NOW);
  return r.ok ? null : r.error;
};

describe("createBackup", () => {
  it("writes one zip with manifest, a database copy and every file, and the zip opens", async () => {
    db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).run();
    await setFilesRoot(root);
    const r = await ok();

    expect(r.path).toBe(join(dest, "dossier-backup-20261110-1432.zip"));
    expect(readdirSync(dest)).toEqual(["dossier-backup-20261110-1432.zip"]);
    expect(r).toMatchObject({ fileCount: 3, filesBytes: 8 + 5 + 1, filesRoot: root });
    const zip = readZip(r.path);
    expect([...zip.keys()].sort()).toEqual(["database/dossier.db", "files/Acme-2026/cv.pdf", "files/Acme-2026/letter.txt", "files/top.txt", "manifest.json"]);
    expect(zip.get("files/Acme-2026/cv.pdf")!.toString()).toBe("cv bytes");

    const parsed = parseManifest(JSON.parse(zip.get("manifest.json")!.toString()));
    expect(parsed.ok && parsed.manifest).toMatchObject({ filesRoot: root, fileCount: 3, filesBytes: 14, createdAt: NOW.toISOString(), schema: { migrations: 5 } });

    // the database entry is a whole database with the same rows; open it from a file the test extracts
    const copy = join(work, "copy.db");
    writeFileSync(copy, zip.get("database/dossier.db")!);
    const c = new Database(copy, { readonly: true });
    expect(c.prepare("SELECT name FROM tracks").all()).toEqual([{ name: "Job" }]);
    expect(c.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: 5 });
    c.close();
  });

  it("is a real zip that unzip accepts (when unzip is installed)", async () => {
    await setFilesRoot(root);
    const r = await ok();
    try {
      expect(execFileSync("unzip", ["-t", r.path], { stdio: "pipe" }).toString()).toMatch(/No errors detected/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  });

  it("leaves the stored files untouched (still read-only) and leaves no temp folder", async () => {
    await setFilesRoot(root);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("dossier-backup-"));
    await ok();
    expect(statSync(join(root, "Acme-2026", "cv.pdf")).mode & 0o222).toBe(0);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("dossier-backup-"))).toEqual(before);
  });

  it("never overwrites: a second backup in the same minute gets a new name", async () => {
    writeFileSync(join(dest, "dossier-backup-20261110-1432.zip"), "precious");
    const r = await ok();
    expect(r.path).toBe(join(dest, "dossier-backup-20261110-1432-2.zip"));
    expect(readFileSync(join(dest, "dossier-backup-20261110-1432.zip"), "utf8")).toBe("precious");
  });

  it("with no files root configured: database only, said so in the manifest", async () => {
    const r = await ok();
    expect(r).toMatchObject({ fileCount: 0, filesRoot: null });
    const zip = readZip(r.path);
    expect([...zip.keys()].sort()).toEqual(["database/dossier.db", "manifest.json"]);
    expect(JSON.parse(zip.get("manifest.json")!.toString())).toMatchObject({ filesRoot: null, fileCount: 0 });
  });

  it("does not follow symlinks out of the files root", async () => {
    const outside = join(work, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "link-dir"));
    symlinkSync(join(outside, "secret.txt"), join(root, "link-file"));
    await setFilesRoot(root);
    const names = [...readZip((await ok()).path).keys()];
    expect(names.some((n) => n.includes("secret") || n.includes("link"))).toBe(false);
  });

  it("records the last successful backup time, and only on success", async () => {
    await setFilesRoot(root);
    expect(await getLastBackupAt()).toBeNull();
    await createBackup("/definitely/not/here", NOW);
    expect(await getLastBackupAt()).toBeNull();
    await ok();
    expect(await getLastBackupAt()).toBe(NOW.toISOString());
  });

  it("owns the last-backup setting by the user id", async () => {
    await ok();
    expect(db.select().from(settings).all().map((s) => [s.userId, s.key])).toContainEqual(["local", "last_backup_at"]);
  });

  it("deletes the zip and the temp folder when the backup fails midway", async () => {
    await setFilesRoot(root);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("dossier-backup-"));
    vi.spyOn(dbBackup, "recordBackup").mockRejectedValue(new Error("boom")); // fails after the zip is complete
    const r = await createBackup(dest, NOW);
    expect(r).toEqual({ ok: false, error: "The backup failed: boom" });
    expect(readdirSync(dest)).toEqual([]);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("dossier-backup-"))).toEqual(before);
  });

  it("deletes the zip when a file disappears while it is being added", async () => {
    await setFilesRoot(root);
    // the walk sees the file, then it is gone when the zip tries to add it
    vi.spyOn(dbBackup, "getSchemaVersion").mockImplementation(() => {
      rmSync(join(root, "top.txt"));
      return { migrations: 3, latest: 1 };
    });
    const r = await createBackup(dest, NOW);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/"top\.txt" in your files folder/) });
    expect(readdirSync(dest)).toEqual([]);
  });

  it("fails, and deletes the zip, when a listed file is swapped for a symlink before it is added", async () => {
    await setFilesRoot(root);
    writeFileSync(join(work, "secret.txt"), "secret");
    vi.spyOn(dbBackup, "getSchemaVersion").mockImplementation(() => {
      rmSync(join(root, "top.txt"));
      symlinkSync(join(work, "secret.txt"), join(root, "top.txt"));
      return { migrations: 3, latest: 1 };
    });
    const r = await createBackup(dest, NOW);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/"top\.txt" in your files folder changed/) });
    expect(readdirSync(dest)).toEqual([]);
  });

  // an unreadable source is the files folder's problem, not the destination's: the message names the file or folder
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("names an unreadable file or folder in the files root, not the destination", async () => {
    await setFilesRoot(root);
    const file = join(root, "Acme-2026", "letter.txt");
    chmodSync(file, 0o000);
    try {
      const e = await err(dest);
      expect(e).toMatch(/cannot read "Acme-2026\/letter\.txt" in your files folder/);
      expect(e).not.toMatch(/cannot write/);
    } finally {
      chmodSync(file, 0o644);
    }
    expect(readdirSync(dest)).toEqual([]);

    const dir = join(root, "Acme-2026");
    chmodSync(dir, 0o000);
    try {
      expect(await err(dest)).toMatch(/cannot read "Acme-2026" in your files folder/);
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(readdirSync(dest)).toEqual([]);
  });
});

describe("createBackup refusals", () => {
  it("refuses empty, relative, ~, missing and non-folder destinations", async () => {
    expect(await err("")).toMatch(/full path/);
    expect(await err(7)).toMatch(/full path/);
    expect(await err("rel/dir")).toMatch(/Relative paths/);
    expect(await err("~/x")).toMatch(/Relative paths/);
    expect(await err(join(work, "nope"))).toMatch(/does not exist/);
    expect(await err(join(root, "top.txt"))).toMatch(/file, not a folder/);
  });

  it("refuses a destination inside the files root, also through a symlink", async () => {
    await setFilesRoot(root);
    expect(await err(root)).toMatch(/contain itself/);
    expect(await err(join(root, "Acme-2026"))).toMatch(/contain itself/);
    symlinkSync(join(root, "Empty"), join(dest, "sneaky"));
    expect(await err(join(dest, "sneaky"))).toMatch(/contain itself/);
    expect(readdirSync(join(root, "Empty"))).toEqual([]);
  });

  it("refuses the project folder and the database folder", async () => {
    expect(await err(process.cwd())).toMatch(/outside the Dossier app folder/);
    expect(await err(join(process.cwd(), "tests"))).toMatch(/outside the Dossier app folder/);
    expect(await err(join(process.env.DATABASE_PATH!, ".."))).toMatch(/outside the Dossier app folder/);
  });

  it("refuses when the configured files folder is missing, instead of silently skipping its files", async () => {
    await setFilesRoot(join(work, "gone"));
    expect(await err(dest)).toMatch(/cannot be found/);
    expect(readdirSync(dest)).toEqual([]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("reports a read-only destination", async () => {
    chmodSync(dest, 0o555);
    try {
      expect(await err(dest)).toMatch(/cannot write/);
    } finally {
      chmodSync(dest, 0o755);
    }
    expect(existsSync(join(dest, "dossier-backup-20261110-1432.zip"))).toBe(false);
  });
});
