import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { applications, cellValues, tracks } from "@/lib/db/schema";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

const tsx = join(process.cwd(), "node_modules/.bin/tsx");
const run = (args: string[], env: Record<string, string> = {}) => execFileSync(tsx, ["scripts/seed-fake.ts", ...args], { env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH!, ...env }, stdio: "pipe" }).toString();

beforeEach(() => { useTestDb(); });
afterEach(dropTestDb);

describe("scripts/seed-fake.ts", () => {
  it("refuses an unseeded database with a clear message", () => {
    expect(() => run(["--count", "10"])).toThrow(/db:seed/);
  });
  it("splits the count over the tracks, writes values, and adds a second batch on a re-run", () => {
    runSeed();
    run(["--count", "50"]);
    const db = getDb();
    const perTrack = db.select({ name: tracks.name, n: count() }).from(applications).innerJoin(tracks, eq(tracks.id, applications.trackId)).groupBy(tracks.name).all();
    expect(Object.fromEntries(perTrack.map((r) => [r.name, r.n]))).toEqual({ Job: 40, PhD: 10 });
    expect(db.select({ n: count() }).from(cellValues).get()!.n).toBeGreaterThan(50 * 5);
    run(["--count", "50"]);
    expect(db.select({ n: count() }).from(applications).get()!.n).toBe(100);
  });
  it("refuses the default real database path without --force, before creating it", () => {
    // Runs from a temp cwd so "./data/dossier.db" resolves inside it: the project's real data/ is never in reach.
    const cwd = mkdtempSync(join(tmpdir(), "dossier-refuse-"));
    try {
      const script = join(process.cwd(), "scripts/seed-fake.ts");
      expect(() => execFileSync(tsx, [script, "--count", "5"], { cwd, env: { ...process.env, DATABASE_PATH: "./data/dossier.db" }, stdio: "pipe" })).toThrow(/Refusing/);
      expect(existsSync(join(cwd, "data/dossier.db"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("refuses a --base that is not a real date", () => {
    expect(() => run(["--base", "2026-02-30"])).toThrow(/--base must be a real date/);
    expect(() => run(["--base", "nope"])).toThrow(/--base must be a real date/);
  });
});
