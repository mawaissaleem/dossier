import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { backUpNow, saveBackupDestination } from "@/app/actions/backup";
import { getBackupDestination, getLastBackupAt } from "@/lib/db/backup";
import { setFilesRoot } from "@/lib/db/settings";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let work: string, root: string, dest: string;
beforeEach(() => {
  vi.mocked(refresh).mockClear();
  useTestDb();
  work = mkdtempSync(join(tmpdir(), "dossier-bka-"));
  root = join(work, "files");
  dest = join(work, "out");
  mkdirSync(root);
  mkdirSync(dest);
  writeFileSync(join(root, "a.txt"), "a");
});
afterEach(() => {
  dropTestDb();
  rmSync(work, { recursive: true, force: true });
});

const canWrite = process.platform !== "win32" && process.getuid?.() !== 0;

describe("saveBackupDestination", () => {
  it("saves a valid folder (normalised) and refreshes the page", async () => {
    expect(await getBackupDestination()).toBeNull();
    expect(await saveBackupDestination(`  ${dest}//  `)).toEqual({ ok: true, path: dest });
    expect(await getBackupDestination()).toBe(dest);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses blank, non-string, relative, missing and file paths, and saves nothing", async () => {
    writeFileSync(join(work, "f.txt"), "x");
    const cases: [unknown, RegExp][] = [
      ["   ", /full path/], [42, /full path/], ["rel/dir", /full path of an existing folder/],
      [join(work, "nope"), /does not exist/], [join(work, "f.txt"), /file, not a folder/],
    ];
    for (const [input, re] of cases) {
      const r = await saveBackupDestination(input);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(re);
    }
    expect(await getBackupDestination()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a folder inside the files folder (the same check the backup makes)", async () => {
    await setFilesRoot(root);
    const r = await saveBackupDestination(root);
    expect(!r.ok && r.error).toMatch(/outside your files folder/);
    expect(await getBackupDestination()).toBeNull();
  });
});

describe("backUpNow", () => {
  it("asks for a destination when none is saved", async () => {
    const r = await backUpNow();
    expect(!r.ok && r.error).toMatch(/save a backup folder/i);
    expect(readdirSync(dest)).toEqual([]);
  });

  it("backs up to the saved folder, records the time and refreshes", async () => {
    await setFilesRoot(root);
    await saveBackupDestination(dest);
    vi.mocked(refresh).mockClear();
    expect(await getLastBackupAt()).toBeNull();
    const r = await backUpNow();
    expect(r).toMatchObject({ ok: true, fileCount: 1 });
    if (!r.ok) return;
    expect(readdirSync(dest)).toEqual([r.path.split("/").pop()]);
    expect(await getLastBackupAt()).toBe(r.createdAt);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("two clicks at once run one backup; the second is told so", async () => {
    await saveBackupDestination(dest);
    const [a, b] = await Promise.all([backUpNow(), backUpNow()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ error: "A backup is already running." });
    expect(readdirSync(dest)).toHaveLength(1);
    expect((await backUpNow()).ok).toBe(true); // the guard is released afterwards
  });

  it("passes the readable error through when the saved folder is gone, and records nothing", async () => {
    await saveBackupDestination(dest);
    rmSync(dest, { recursive: true });
    vi.mocked(refresh).mockClear();
    const r = await backUpNow();
    expect(!r.ok && r.error).toMatch(/does not exist/);
    expect(await getLastBackupAt()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.skipIf(!canWrite)("passes the unwritable-folder error through", async () => {
    await saveBackupDestination(dest);
    chmodSync(dest, 0o500);
    try {
      const r = await backUpNow();
      expect(!r.ok && r.error).toMatch(/cannot write to that folder/);
      expect(await getLastBackupAt()).toBeNull();
    } finally {
      chmodSync(dest, 0o700);
    }
  });
});
