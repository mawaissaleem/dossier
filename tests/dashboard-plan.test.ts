import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlannerList, getWeeksPlan, setCapacity } from "@/lib/db/planner";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

// 11.1: the dashboard card is getWeeksPlan(today) drawn by RankingList, so it must be the same top N as /planner.
describe("dashboard plan card data", () => {
  const TODAY = "2026-11-12";
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  function setup(count: number) {
    const t = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const col = (name: string, type: "single_select" | "date", position: number, isStatus = false) => db.insert(columns).values({ userId: "local", trackId: t, name, type, position, isStatus }).returning().get().id;
    const [status, , dl] = [col("Status", "single_select", 0, true), col("Priority", "single_select", 1), col("Deadline", "date", 2)];
    const todo = db.insert(columnOptions).values({ userId: "local", columnId: status, label: "To apply", color: "blue", position: 0, bufferDays: 0 }).returning().get().id;
    for (let i = 1; i <= count; i++) {
      const a = db.insert(applications).values({ userId: "local", trackId: t, title: `app-${i}` }).returning().get().id;
      db.insert(cellValues).values([
        { userId: "local", applicationId: a, columnId: status, valueOptionId: todo },
        { userId: "local", applicationId: a, columnId: dl, valueDate: `2026-11-${String(12 + i).padStart(2, "0")}` },
      ]).run();
    }
  }

  it("is the first `capacity` of the planner's list, in the same order", async () => {
    setup(6);
    await setCapacity(3);
    const [{ capacity, plan }, list] = [await getWeeksPlan(TODAY), await getPlannerList(TODAY)];
    expect(capacity).toBe(3);
    expect(plan.map((p) => p.title)).toEqual(["app-1", "app-2", "app-3"]);
    expect(plan).toEqual(list.slice(0, 3));
  });

  it("shows fewer than capacity when fewer are ranked, and nothing when none are", async () => {
    expect((await getWeeksPlan(TODAY)).plan).toEqual([]);
    setup(2);
    expect((await getWeeksPlan(TODAY)).plan).toHaveLength(2); // capacity 4
  });
});
