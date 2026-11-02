import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApplicationDetail, listApplicationRows } from "@/lib/db/applications";
import { setCellValue } from "@/lib/db/cells";
import { listColumns } from "@/lib/db/columns";
import { applications, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let trackId: number;
const app = (title: string, over: Partial<typeof applications.$inferInsert> = {}) =>
  db.insert(applications).values({ userId: "local", trackId, title, ...over }).returning().get().id;
const col = (type: (typeof columns.$inferInsert)["type"], over: Partial<typeof columns.$inferInsert> = {}) =>
  db.insert(columns).values({ userId: "local", trackId, name: `${type}-${Math.random()}`, type, position: 0, ...over }).returning().get().id;
const opt = (columnId: number, label: string, position = 0, userId = "local") =>
  db.insert(columnOptions).values({ userId, columnId, label, color: "red", position }).returning().get().id;

beforeEach(() => {
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
});
afterEach(dropTestDb);

describe("listColumns", () => {
  it("orders by position then id, keeps hidden, attaches options in order", async () => {
    const b = col("text", { name: "b", position: 1 });
    const a = col("text", { name: "a", position: 0, hidden: true });
    const c = col("text", { name: "c", position: 1 });
    const s = col("single_select", { name: "s", position: 2, isStatus: true });
    const o2 = opt(s, "Two", 1);
    const o1 = opt(s, "One", 0);
    const list = await listColumns(trackId);
    expect(list.map((x) => x.id)).toEqual([a, b, c, s]);
    expect(list[0]).toMatchObject({ name: "a", type: "text", hidden: true, isStatus: false, options: [] });
    expect(list[3].isStatus).toBe(true);
    expect(list[3].options).toEqual([
      { id: o1, label: "One", color: "red", position: 0 },
      { id: o2, label: "Two", color: "red", position: 1 },
    ]);
  });

  it("returns nothing for another user's track or another track", async () => {
    col("text");
    const other = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    expect(await listColumns(other)).toEqual([]);
    db.insert(columns).values({ userId: "someone", trackId: other, name: "x", type: "text", position: 0 }).run();
    expect(await listColumns(other)).toEqual([]);
  });
});

describe("listApplicationRows", () => {
  it("uses the column list it is given instead of querying columns again", async () => {
    const a = col("text");
    col("text");
    app("A");
    const cols = (await listColumns(trackId)).slice(0, 1);
    const [row] = await listApplicationRows(trackId, cols);
    expect(Object.keys(row.values)).toEqual([String(a)]);
  });

  it("returns every column key, null for blanks, and typed values for the 6 types", async () => {
    const t = col("text"), n = col("number"), d = col("date"), l = col("link"), k = col("checkbox"), s = col("single_select");
    const o = opt(s, "Applied");
    const blank = col("text");
    const id = app("A");
    await setCellValue(id, t, "hi");
    await setCellValue(id, n, 4.5);
    await setCellValue(id, d, "2026-03-04");
    await setCellValue(id, l, "example.com");
    await setCellValue(id, k, false);
    await setCellValue(id, s, o);
    const [row] = await listApplicationRows(trackId);
    expect(row).toEqual({
      id, title: "A",
      values: { [t]: "hi", [n]: 4.5, [d]: "2026-03-04", [l]: "https://example.com/", [k]: false, [s]: o, [blank]: null },
    });
  });

  it("is newest first and excludes archived, other-track and other-user rows", async () => {
    const t = col("text");
    const first = app("first");
    const second = app("second");
    app("archived", { archived: true });
    const other = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    db.insert(applications).values({ userId: "local", trackId: other, title: "elsewhere" }).run();
    await setCellValue(first, t, "x");
    expect((await listApplicationRows(trackId)).map((r) => r.id)).toEqual([second, first]);

    const foreign = db.insert(tracks).values({ userId: "someone", name: "Theirs", position: 0 }).returning().get().id;
    db.insert(applications).values({ userId: "someone", trackId: foreign, title: "theirs" }).run();
    expect(await listApplicationRows(foreign)).toEqual([]);
  });

  it("shows a column added after rows exist as null on all of them", async () => {
    const a = app("a"), b = app("b");
    const later = col("text", { name: "later" });
    const rows = await listApplicationRows(trackId);
    expect(rows.map((r) => r.id)).toEqual([b, a]);
    for (const r of rows) expect(r.values).toEqual({ [later]: null });
  });

  it("runs a fixed number of queries regardless of row count", async () => {
    const t = col("text");
    col("single_select");
    const count = async () => {
      const spy = vi.spyOn(db.$client, "prepare");
      await listApplicationRows(trackId);
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };
    const id = app("one");
    await setCellValue(id, t, "x");
    const few = await count();
    for (let i = 0; i < 200; i++) await setCellValue(app(`app ${i}`), t, `v${i}`);
    expect((await listApplicationRows(trackId)).length).toBe(201);
    expect(await count()).toBe(few);
    expect(few).toBeLessThanOrEqual(4);
  });
});

describe("getApplicationDetail", () => {
  it("returns every column in order with typed values, blanks as null, hidden and archived included", async () => {
    const t = col("text", { name: "t", position: 0 });
    const n = col("number", { position: 1, hidden: true });
    const d = col("date", { position: 2 });
    const l = col("link", { position: 3 });
    const c = col("checkbox", { position: 4 });
    const s = col("single_select", { position: 5 });
    const blank = col("text", { position: 6 });
    const o = opt(s, "Applied");
    const id = app("Acme", { archived: true });
    for (const [cid, v] of [[t, "hi"], [n, 4.5], [d, "2026-01-02"], [l, "https://a.b/"], [c, true], [s, o]] as const) {
      expect((await setCellValue(id, cid, v)).ok).toBe(true);
    }
    const detail = await getApplicationDetail(id);
    expect(detail).toMatchObject({ id, title: "Acme", archived: true, track: { id: trackId, name: "Job" } });
    expect(detail!.columns.map((x) => x.id)).toEqual([t, n, d, l, c, s, blank]);
    expect(detail!.columns[1].hidden).toBe(true);
    expect(detail!.columns[5].options).toHaveLength(1);
    expect(detail!.values).toEqual({ [t]: "hi", [n]: 4.5, [d]: "2026-01-02", [l]: "https://a.b/", [c]: true, [s]: o, [blank]: null });
  });

  it("ignores another application's cells; null for another user's application or track, and a missing id", async () => {
    const t = col("text");
    const a = app("A");
    const b = app("B");
    await setCellValue(b, t, "other");
    expect((await getApplicationDetail(a))!.values).toEqual({ [t]: null });
    const foreignTrack = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 1 }).returning().get().id;
    const foreignApp = db.insert(applications).values({ userId: "someone-else", trackId: foreignTrack, title: "F" }).returning().get().id;
    const mixed = db.insert(applications).values({ userId: "local", trackId: foreignTrack, title: "M" }).returning().get().id;
    expect(await getApplicationDetail(foreignApp)).toBeNull();
    expect(await getApplicationDetail(mixed)).toBeNull();
    expect(await getApplicationDetail(99999)).toBeNull();
  });
});
