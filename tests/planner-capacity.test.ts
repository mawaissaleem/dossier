import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveCapacity } from "@/app/actions/settings";
import { getCapacity, getWeeksPlan, setCapacity } from "@/lib/db/planner";
import { setSetting } from "@/lib/db/settings";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { checkCapacity, parseCapacityInput, resolveCapacity, weeksPlan } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

describe("capacity rules", () => {
  it("resolve: whole numbers 1..50 stay, everything else is 4", () => {
    expect([1, 4, 50].map(resolveCapacity)).toEqual([1, 4, 50]);
    for (const v of [undefined, null, 0, 51, -1, 2.5, "7", NaN, Infinity, {}, [3]]) expect(resolveCapacity(v)).toBe(4);
  });
  it("check refuses non-integers and out of range", () => {
    expect(checkCapacity(7)).toEqual({ capacity: 7 });
    for (const v of ["4", "", null, 0, 51, 1.5, NaN]) expect(checkCapacity(v)).toHaveProperty("error");
  });
  it("parse: digits become a number, the rest stays text so the check refuses it", () => {
    expect(parseCapacityInput(" 12 ")).toBe(12);
    for (const raw of ["", "  ", "4x", "-1", "1.5", "1e1"]) expect(checkCapacity(parseCapacityInput(raw))).toHaveProperty("error");
    expect(checkCapacity(parseCapacityInput("0"))).toHaveProperty("error");
    expect(checkCapacity(parseCapacityInput("51"))).toHaveProperty("error");
  });
});

describe("weeksPlan", () => {
  const list = Array.from({ length: 60 }, (_, i) => i + 1);
  it("takes the first N and keeps the rest in order", () => {
    expect(weeksPlan(list, 4)).toEqual({ plan: [1, 2, 3, 4], rest: list.slice(4) });
    expect(weeksPlan(list, 1)).toEqual({ plan: [1], rest: list.slice(1) });
    expect(weeksPlan(list, 50).plan).toHaveLength(50);
    expect(weeksPlan(list, 50).rest).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  });
  it("fewer items than N: everything is the plan", () => {
    expect(weeksPlan([1, 2], 4)).toEqual({ plan: [1, 2], rest: [] });
    expect(weeksPlan([], 4)).toEqual({ plan: [], rest: [] });
  });
  it("a bad capacity counts as 4", () => {
    expect(weeksPlan(list, 0).plan).toEqual([1, 2, 3, 4]);
    expect(weeksPlan(list, 99).plan).toEqual([1, 2, 3, 4]);
  });
});

describe("capacity through the database", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
  afterEach(dropTestDb);

  it("never saved = 4; set saves; refusals save nothing", async () => {
    expect(await getCapacity()).toBe(4);
    expect(await setCapacity(9)).toEqual({ ok: true });
    expect(await getCapacity()).toBe(9);
    for (const v of [0, 51, 2.5, "5", null, undefined, NaN]) expect(await setCapacity(v)).toMatchObject({ ok: false });
    expect(await getCapacity()).toBe(9);
  });

  it("a hand-edited stored value reads as 4", async () => {
    await setSetting("planner.capacity", 500);
    expect(await getCapacity()).toBe(4);
    await setSetting("planner.capacity", "many");
    expect(await getCapacity()).toBe(4);
  });

  it("the action refreshes only on success", async () => {
    expect(await saveCapacity(6)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveCapacity("6x")).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await getCapacity()).toBe(6);
  });

  it("getWeeksPlan: the top N of the ranking (undated after dated), the rest after, and a changed capacity changes the cut", async () => {
    const tr = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const col = (name: string, type: "single_select" | "date", position: number, isStatus = false) => db.insert(columns).values({ userId: "local", trackId: tr, name, type, position, isStatus }).returning().get().id;
    const status = col("Status", "single_select", 0, true), dl = col("Deadline", "date", 1);
    const todo = db.insert(columnOptions).values({ userId: "local", columnId: status, label: "To apply", color: "blue", position: 0 }).returning().get().id;
    const add = (title: string, deadline: string | null) => {
      const a = db.insert(applications).values({ userId: "local", trackId: tr, title }).returning().get().id;
      db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: status, valueOptionId: todo }).run();
      if (deadline) db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: dl, valueDate: deadline }).run();
    };
    add("d3", "2026-11-20"); add("none", null); add("d1", "2026-11-14"); add("d2", "2026-11-16");
    const names = (xs: { title: string }[]) => xs.map((x) => x.title);
    let r = await getWeeksPlan("2026-11-12");
    expect(r.capacity).toBe(4);
    expect([names(r.plan), names(r.rest)]).toEqual([["d1", "d2", "d3", "none"], []]);
    await setCapacity(2);
    r = await getWeeksPlan("2026-11-12");
    expect([r.capacity, names(r.plan), names(r.rest)]).toEqual([2, ["d1", "d2"], ["d3", "none"]]);
    expect(r.plan[0].reasoning).toContain("due in 2 days");
    await setCapacity(3);
    expect(names((await getWeeksPlan("2026-11-12")).plan)).toEqual(["d1", "d2", "d3"]);
  });
});
