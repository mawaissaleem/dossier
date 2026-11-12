import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstN } from "@/lib/dashboard";
import { getFollowUpsDue } from "@/lib/db/planner";
import { applications, cellValues, columns, submissions, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

describe("firstN (pure)", () => {
  it("cuts to n and counts the rest", () => {
    expect(firstN([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({ shown: [1, 2, 3, 4, 5], more: 2 });
  });
  it("no rest when n or fewer; empty stays empty", () => {
    expect(firstN([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(firstN([], 5)).toEqual({ shown: [], more: 0 });
  });
});

// 11.2: the card is getFollowUpsDue(today) cut by firstN, so the shown rows are the first of /planner's list, oldest first.
describe("dashboard follow-ups card data", () => {
  const TODAY = "2026-11-12";
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  it("shown rows are the head of getFollowUpsDue and the count is the whole list", async () => {
    const t = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const fu = db.insert(columns).values({ userId: "local", trackId: t, name: "Follow-up date", type: "date", position: 0 }).returning().get().id;
    for (let i = 1; i <= 7; i++) {
      const a = db.insert(applications).values({ userId: "local", trackId: t, title: `app-${i}` }).returning().get().id;
      db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: fu, valueDate: `2026-11-${String(i).padStart(2, "0")}` }).run();
      db.insert(submissions).values({ userId: "local", applicationId: a, date: "2026-10-01" }).run();
    }
    const items = await getFollowUpsDue(TODAY);
    const { shown, more } = firstN(items, 5);
    expect(items).toHaveLength(7);
    expect(shown.map((x) => x.title)).toEqual(["app-1", "app-2", "app-3", "app-4", "app-5"]);
    expect(more).toBe(2);
  });
});
