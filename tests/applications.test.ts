import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "@/app/actions/applications";
import { applications, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let trackId: number;
beforeEach(() => {
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
});
afterEach(dropTestDb);

describe("createApplication", () => {
  it("inserts a row with the trimmed title", async () => {
    const r = await createApplication("  Acme engineer  ", trackId);
    expect(r.ok).toBe(true);
    const rows = db.select().from(applications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.ok && r.id, userId: "local", trackId, title: "Acme engineer" });
  });

  it.each([
    ["empty title", "", 1],
    ["whitespace title", "   ", 1],
    ["title over 300 chars", "x".repeat(301), 1],
    ["trackId 0", "ok", 0],
    ["trackId -1", "ok", -1],
    ["string trackId", "ok", "1" as unknown as number],
    ["NaN trackId", "ok", NaN],
    ["float trackId", "ok", 1.5],
    ["missing track", "ok", 9999],
  ])("rejects %s and inserts nothing", async (_n, title, id) => {
    expect((await createApplication(title, id)).ok).toBe(false);
    expect(db.select().from(applications).all()).toHaveLength(0);
  });

  it("accepts a 300-char title", async () => {
    expect((await createApplication("x".repeat(300), trackId)).ok).toBe(true);
  });

  it("rejects another user's track", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    expect(await createApplication("ok", other)).toEqual({ ok: false, error: "Track not found." });
    expect(db.select().from(applications).all()).toHaveLength(0);
  });
});
