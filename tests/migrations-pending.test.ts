import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as search } from "@/app/api/search/route";
import { GET as openFile } from "@/app/api/files/[id]/route";
import { closeDb, getDb } from "@/lib/db/client";
import { UPDATE_STEPS, databaseUpdateResponse, pendingMigrations, updateIntro } from "@/lib/db/migrations";
import { dropTestDb, useTestDb } from "./helpers/db";

const TOTAL = (JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
let extra: string | undefined;

beforeEach(() => {
  useTestDb();
});
afterEach(() => {
  dropTestDb();
  if (extra) rmSync(extra, { recursive: true, force: true });
  extra = undefined;
});

// Forget the newest n migrations, as if the database file had been made by an older version of the app.
const forget = (n: number) =>
  getDb().run(
    sql`DELETE FROM __drizzle_migrations WHERE created_at IN (SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT ${n})`,
  );

describe("pending migrations", () => {
  it("an up-to-date database has none and no message", () => {
    expect(TOTAL).toBeGreaterThan(1);
    expect(pendingMigrations()).toBe(0);
    expect(databaseUpdateResponse()).toBeNull();
  });
  it("a database behind by N says N, and recovers by itself once it is migrated", async () => {
    forget(2);
    expect(pendingMigrations()).toBe(2);
    const r = databaseUpdateResponse()!;
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { error } = await r.json();
    expect(error).toContain("Your database needs updating");
    expect(error).toContain("2 database updates");
    expect(error).toContain("npm run db:migrate");
    expect(updateIntro(1)).toContain("1 database update that has");
    expect(UPDATE_STEPS.join(" ")).not.toContain("db:seed");
    expect(error).toContain("Back up and update");
    expect(UPDATE_STEPS.join(" ")).toMatch(/Stop.*Back up.*db:migrate.*Start/);
    getDb().run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('x', ${Date.now() + 1e9})`);
    expect(pendingMigrations()).toBe(0);
  });
  it("behind by all of them (only the first migration applied) counts the rest", () => {
    forget(TOTAL - 1);
    expect(pendingMigrations()).toBe(TOTAL - 1);
  });
  it("a brand-new empty database file is created by the check, not left pending (see database-update.test.ts)", () => {
    closeDb();
    extra = mkdtempSync(join(tmpdir(), "dossier-empty-"));
    process.env.DATABASE_PATH = join(extra, "empty.db");
    expect(pendingMigrations()).toBe(0);
    expect(getDb().$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: TOTAL });
  });
  it("the check is cheap: up to date it is remembered, behind it is one small query", () => {
    let t = performance.now();
    for (let i = 0; i < 10_000; i++) pendingMigrations();
    expect(performance.now() - t).toBeLessThan(500);
    forget(1);
    t = performance.now();
    for (let i = 0; i < 1000; i++) pendingMigrations();
    expect(performance.now() - t).toBeLessThan(2000);
  });
  it("a journal that cannot be read does not block: 0 pending, logged once", async () => {
    forget(1);
    const cwd = process.cwd();
    extra = mkdtempSync(join(tmpdir(), "dossier-nojournal-"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules(); // a fresh module, so the journal has not been read yet
    const fresh = await import("@/lib/db/migrations");
    const client = await import("@/lib/db/client");
    try {
      process.chdir(extra);
      expect(fresh.pendingMigrations()).toBe(0);
      expect(fresh.databaseUpdateResponse()).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain("_journal.json");
    } finally {
      process.chdir(cwd);
      client.closeDb();
      log.mockRestore();
    }
  });
  it("API routes answer 503 JSON with the message while behind, after the local-host check", async () => {
    forget(1);
    const bad = await search(
      new NextRequest("http://localhost:3000/api/search?q=a", { headers: { host: "localhost:3000" } }),
    );
    expect(bad.status).toBe(503);
    expect((await bad.json()).error).toContain("npm run db:migrate");
    const file = await openFile(
      new NextRequest("http://localhost:3000/api/files/1", { headers: { host: "localhost:3000" } }),
      { params: Promise.resolve({ id: "1" }) } as never,
    );
    expect(file.status).toBe(503);
    const foreign = await search(
      new NextRequest("http://localhost:3000/api/search?q=a", { headers: { host: "evil.example" } }),
    );
    expect(foreign.status).toBe(403);
  });
});
