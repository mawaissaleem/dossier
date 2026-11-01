import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplication } from "@/app/actions/applications";
import { listApplications } from "@/lib/db/applications";
import { applications, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

// refresh() only works inside a real Server Action request.
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

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

describe("listApplications", () => {
  it("returns only this track's non-archived rows for the current user, newest first", async () => {
    const other = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const add = (v: Partial<typeof applications.$inferInsert> & { title: string }) =>
      db.insert(applications).values({ userId: "local", trackId, ...v }).returning().get().id;
    const a = add({ title: "first" });
    add({ title: "archived", archived: true });
    add({ title: "other track", trackId: other });
    add({ title: "other user", userId: "someone-else" });
    const c = add({ title: "second" });
    expect(await listApplications(trackId)).toEqual([{ id: c, title: "second" }, { id: a, title: "first" }]);
  });
});
