import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveFilesRoot } from "@/app/actions/settings";
import { getFilesRoot } from "@/lib/db/settings";
import { isInside, validateFilesRoot } from "@/lib/files/root";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let dir: string;
beforeEach(() => {
  vi.mocked(refresh).mockClear();
  useTestDb();
  dir = mkdtempSync(join(tmpdir(), "dossier-root-"));
});
afterEach(() => {
  dropTestDb();
  rmSync(dir, { recursive: true, force: true });
});

const err = async (input: unknown) => {
  const r = await validateFilesRoot(input);
  return r.ok ? null : r.error;
};
const canWrite = process.platform !== "win32" && process.getuid?.() !== 0;

describe("validateFilesRoot", () => {
  it("accepts an existing writable folder, normalised, and leaves no probe file behind", async () => {
    expect(await validateFilesRoot(`  ${dir}/sub/..//  `)).toEqual({ ok: true, path: dir });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rejects empty, non-string, relative, ~ and NUL paths", async () => {
    expect(await err("   ")).toMatch(/full path of a folder/);
    expect(await err(42)).toMatch(/full path of a folder/);
    expect(await err("some/relative")).toMatch(/Relative paths/);
    expect(await err("~/files")).toMatch(/Relative paths/);
    expect(await err(`${dir}/a\0b`)).toMatch(/invalid character/);
    expect(await err("/" + "a".repeat(5000))).toMatch(/too long/);
  });

  it("rejects a missing path and a file", async () => {
    expect(await err(join(dir, "nope"))).toMatch(/does not exist/);
    writeFileSync(join(dir, "f.txt"), "x");
    expect(await err(join(dir, "f.txt"))).toMatch(/file, not a folder/);
  });

  it.skipIf(!canWrite)("rejects a read-only folder", async () => {
    const ro = join(dir, "ro");
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    try {
      expect(await err(ro)).toMatch(/cannot write/);
    } finally {
      chmodSync(ro, 0o700);
    }
  });

  it("accepts a symlinked root and stores the path as typed", async () => {
    const real = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(real);
    symlinkSync(real, link, "dir");
    expect(await validateFilesRoot(link)).toEqual({ ok: true, path: link });
  });

  it("rejects the project folder, folders in it, the database folder, and symlinks into them", async () => {
    expect(await err(process.cwd())).toMatch(/outside the Dossier app folder/);
    expect(await err(join(process.cwd(), "node_modules"))).toMatch(/outside the Dossier app folder/);
    const dbDir = dirname(process.env.DATABASE_PATH!);
    expect(await err(dbDir)).toMatch(/outside the Dossier app folder/);
    const sub = join(dbDir, "files");
    mkdirSync(sub);
    expect(await err(sub)).toMatch(/outside the Dossier app folder/);
    const link = join(dir, "to-db");
    symlinkSync(dbDir, link, "dir");
    expect(await err(link)).toMatch(/outside the Dossier app folder/);
  });

  it("isInside is a path-segment check, not a string prefix", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
    expect(isInside("/a/b-archive", "/a/b")).toBe(false);
    expect(isInside("/a/..b", "/a")).toBe(true);
    expect(isInside("/a", "/a/b")).toBe(false);
  });
});

describe("saveFilesRoot", () => {
  it("saves a valid path, normalised, and refreshes the page", async () => {
    const r = await saveFilesRoot(`${dir}/`);
    expect(r).toEqual({ ok: true, path: dir });
    expect(await getFilesRoot()).toBe(dir);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("returns the error and saves nothing for an invalid path, keeping the previous root", async () => {
    await saveFilesRoot(dir);
    const r = await saveFilesRoot(join(dir, "missing"));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/does not exist/) });
    expect(await getFilesRoot()).toBe(dir);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveFilesRoot(null as unknown as string)).toMatchObject({ ok: false });
  });

  it("changing an already-set root just re-validates and saves the new one", async () => {
    const other = join(dir, "other");
    mkdirSync(other);
    await saveFilesRoot(dir);
    expect((await saveFilesRoot(other)).ok).toBe(true);
    expect(await getFilesRoot()).toBe(other);
  });
});
