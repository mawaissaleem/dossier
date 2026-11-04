import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { reorderOptions } from "@/app/actions/options";
import { listColumns } from "@/lib/db/columns";
import { columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let colId: number;
let ids: number[]; // A, B, C at positions 0, 1, 2
const rows = () => db.select().from(columnOptions).all().map((o) => [o.id, o.position]);
const order = async () => (await listColumns(trackId))[0].options.map((o) => o.label);

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  colId = db.insert(columns).values({ userId: "local", trackId, name: "Status", type: "single_select", isStatus: true, position: 0 }).returning().get().id;
  ids = ["A", "B", "C"].map((label, position) => db.insert(columnOptions).values({ userId: "local", columnId: colId, label, color: "blue", position }).returning().get().id);
});
afterEach(dropTestDb);

describe("reorderOptions", () => {
  it("persists the new order as positions 0..n-1 and the column lists it that way", async () => {
    expect(await reorderOptions(colId, [ids[2], ids[0], ids[1]])).toEqual({ ok: true });
    expect(await order()).toEqual(["C", "A", "B"]);
    expect(db.select().from(columnOptions).all().map((o) => o.position).sort()).toEqual([0, 1, 2]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("repairs gaps in stored positions", async () => {
    db.update(columnOptions).set({ position: 40 }).run();
    expect(await reorderOptions(colId, ids)).toEqual({ ok: true });
    expect(db.select().from(columnOptions).all().map((o) => o.position).sort()).toEqual([0, 1, 2]);
  });

  it("rejects missing, extra, duplicate, foreign and malformed lists with nothing changed", async () => {
    const otherTrack = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = db.insert(columns).values({ userId: "someone-else", trackId: otherTrack, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const foreign = db.insert(columnOptions).values({ userId: "someone-else", columnId: foreignCol, label: "F", color: "red", position: 0 }).returning().get().id;
    const before = JSON.stringify(rows());
    const bad: unknown[] = [[ids[0], ids[1]], [...ids, foreign], [ids[0], ids[0], ids[1]], [ids[0], ids[1], foreign], [], "abc", null, [ids[0], ids[1], "x"], [ids[0], ids[1], 0], [ids[0], ids[1], 1.5]];
    for (const list of bad) expect((await reorderOptions(colId, list as number[])).ok).toBe(false);
    expect(JSON.stringify(rows())).toBe(before);
    // The five well-formed but stale lists refresh so the editor gets the server order back; malformed input never reaches the DB.
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(await reorderOptions(colId, [ids[0], ids[1]])).toEqual({ ok: false, error: "The options changed. The list now shows the current order; try again." });
  });

  it("rejects another user's column, a missing column and a non-select column; nothing changes", async () => {
    const otherTrack = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = db.insert(columns).values({ userId: "someone-else", trackId: otherTrack, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const f = db.insert(columnOptions).values({ userId: "someone-else", columnId: foreignCol, label: "F", color: "red", position: 0 }).returning().get().id;
    const f2 = db.insert(columnOptions).values({ userId: "someone-else", columnId: foreignCol, label: "G", color: "red", position: 1 }).returning().get().id;
    const text = db.insert(columns).values({ userId: "local", trackId, name: "Notes", type: "text", position: 1 }).returning().get().id;
    const before = JSON.stringify(rows());
    expect(await reorderOptions(foreignCol, [f2, f])).toEqual({ ok: false, error: "Column not found." });
    expect(await reorderOptions(999, [])).toEqual({ ok: false, error: "Column not found." });
    expect(await reorderOptions(-1, [])).toEqual({ ok: false, error: "Column not found." });
    expect((await reorderOptions(text, [])).ok).toBe(false);
    expect(JSON.stringify(rows())).toBe(before);
    expect(refresh).toHaveBeenCalledTimes(3); // not for -1, which the action rejects before the data layer
  });
});
