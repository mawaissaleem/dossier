import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { deleteColumn, fetchColumnDeleteImpact } from "@/app/actions/columns";
import { addColumn, getColumnDeleteImpact, listColumns } from "@/lib/db/columns";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let ids: number[]; // A, B, C in position order
let apps: number[]; // 4 applications, the last one archived
const everything = () => JSON.stringify([db.select().from(columns).all(), db.select().from(cellValues).all(), db.select().from(columnOptions).all()]);
const cell = (applicationId: number, columnId: number, extra: Partial<typeof cellValues.$inferInsert> = {}) =>
  db.insert(cellValues).values({ userId: "local", applicationId, columnId, ...extra }).run();

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  ids = ["A", "B", "C"].map((name, position) => db.insert(columns).values({ userId: "local", trackId, name, type: "text", position }).returning().get().id);
  apps = [0, 1, 2, 3].map((i) => db.insert(applications).values({ userId: "local", trackId, title: `App ${i}`, archived: i === 3 }).returning().get().id);
});
afterEach(dropTestDb);

describe("getColumnDeleteImpact", () => {
  it("counts cell rows only (blanks have none), archived included and reported separately", async () => {
    cell(apps[0], ids[0], { valueText: "x" });
    cell(apps[1], ids[0], { valueText: "y" });
    cell(apps[3], ids[0], { valueText: "archived one" });
    cell(apps[0], ids[1], { valueText: "other column" });
    expect(await getColumnDeleteImpact(ids[0])).toEqual({ name: "A", valueCount: 3, archivedCount: 1 });
    expect(await getColumnDeleteImpact(ids[2])).toEqual({ name: "C", valueCount: 0, archivedCount: 0 });
  });

  it("is fresh on each call", async () => {
    expect((await getColumnDeleteImpact(ids[0]))?.valueCount).toBe(0);
    cell(apps[0], ids[0], { valueText: "x" });
    expect((await getColumnDeleteImpact(ids[0]))?.valueCount).toBe(1);
  });

  it("null for missing and other users' columns", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "Z", type: "text", position: 0 }).returning().get().id;
    expect(await getColumnDeleteImpact(foreign)).toBeNull();
    expect(await getColumnDeleteImpact(9999)).toBeNull();
  });
});

describe("deleteColumn action", () => {
  it("removes the column, its cells and options; others and the applications stay; order is kept (gap left)", async () => {
    cell(apps[0], ids[0], { valueText: "x" });
    cell(apps[0], ids[1], { valueText: "keep" });
    expect(await deleteColumn(ids[0], true, 1)).toEqual({ ok: true });
    expect((await listColumns(trackId)).map((c) => c.name)).toEqual(["B", "C"]);
    expect(db.select().from(cellValues).all().map((c) => c.columnId)).toEqual([ids[1]]);
    expect(db.select().from(applications).all()).toHaveLength(4);
    expect(db.select().from(columns).all().map((c) => c.position)).toEqual([1, 2]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await addColumn({ trackId, name: "D", type: "text" })).ok).toBe(true);
  });

  it("deletes a single_select column whose options are referenced by its own cells", async () => {
    const sel = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 3 }).returning().get().id;
    const opt = db.insert(columnOptions).values({ userId: "local", columnId: sel, label: "Open", color: "blue", position: 0 }).returning().get().id;
    cell(apps[0], sel, { valueOptionId: opt });
    cell(apps[1], sel, { valueOptionId: opt });
    expect(await deleteColumn(sel, true, 2)).toEqual({ ok: true });
    expect(db.select().from(columns).where(eq(columns.id, sel)).all()).toHaveLength(0);
    expect(db.select().from(columnOptions).all()).toHaveLength(0);
    expect(db.select().from(cellValues).all()).toHaveLength(0);
  });

  it("rejects without confirm (anything but true) and deletes nothing", async () => {
    cell(apps[0], ids[0], { valueText: "x" });
    const before = everything();
    for (const c of [false, undefined, "true", 1]) expect(await deleteColumn(ids[0], c as boolean, 1)).toEqual({ ok: false, error: "Deleting must be confirmed." });
    for (const n of [undefined, -1, 1.5, "1", null]) expect(await deleteColumn(ids[0], true, n as number)).toEqual({ ok: false, error: "Deleting must be confirmed." });
    expect(everything()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses the status column", async () => {
    db.update(columns).set({ isStatus: true }).where(eq(columns.id, ids[0])).run();
    cell(apps[0], ids[0], { valueText: "x" });
    const before = everything();
    expect(await deleteColumn(ids[0], true, 1)).toEqual({ ok: false, error: "The Status column cannot be deleted." });
    expect(everything()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects other users' columns, unknown ids and bad ids; nothing changes", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "Z", type: "text", position: 0 }).returning().get().id;
    const before = everything();
    for (const c of [foreign, 9999, 0, 1.5, "1"]) expect(await deleteColumn(c as number, true, 0)).toEqual({ ok: false, error: "Column not found." });
    expect(everything()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("stale value count (NFR-4: values added while the dialog was open are never deleted unannounced)", () => {
  it("refuses when the count changed since it was shown (more or fewer), deletes nothing, then works with the fresh count", async () => {
    cell(apps[0], ids[0], { valueText: "x" });
    const shown = await fetchColumnDeleteImpact(ids[0]);
    expect(shown).toEqual({ ok: true, name: "A", valueCount: 1, archivedCount: 0 });
    cell(apps[3], ids[0], { valueText: "added in another tab" });
    const before = everything();
    for (const n of [1, 3, 0]) expect(await deleteColumn(ids[0], true, n)).toEqual({ ok: false, error: "The number of values in this column changed. Check again." });
    expect(everything()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
    const fresh = await fetchColumnDeleteImpact(ids[0]);
    expect(fresh.ok && fresh.valueCount).toBe(2);
    expect(await deleteColumn(ids[0], true, 2)).toEqual({ ok: true });
  });
});

describe("fetchColumnDeleteImpact action", () => {
  it("returns the count, and an error for bad or foreign ids", async () => {
    cell(apps[3], ids[0], { valueText: "x" });
    expect(await fetchColumnDeleteImpact(ids[0])).toEqual({ ok: true, name: "A", valueCount: 1, archivedCount: 1 });
    expect(await fetchColumnDeleteImpact(9999)).toEqual({ ok: false, error: "Column not found." });
    expect(await fetchColumnDeleteImpact("1" as unknown as number)).toEqual({ ok: false, error: "Column not found." });
  });
});
