import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveRankingRules } from "@/app/actions/settings";
import { getPlannerRanking, getRankingRules, setRankingRules } from "@/lib/db/planner";
import { setSetting } from "@/lib/db/settings";
import { activityEvents, applications, cellValues, columnOptions, columns, notes, tracks, type ColumnType } from "@/lib/db/schema";
import { orderRanking, rankApplications, resolveNoDeadline, resolveOverdue, undatedScore, type BufferOption, type NoDeadlinePolicy, type OverduePolicy, type PlannerApp } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const TODAY = "2026-11-12";
const BIG = 1, NONE = 2, HEAVY = 10;
const prio: BufferOption[] = [{ id: BIG, position: 0, bufferDays: 3 }, { id: NONE, position: 1, bufferDays: 0 }];
const eff: BufferOption[] = [{ id: HEAVY, position: 0, bufferDays: 2 }];
const app = (id: number, deadline: unknown, priority: number | null = null, effort: number | null = null): PlannerApp => ({ id, deadline, priority, effort });

function order(apps: PlannerApp[], overdue: OverduePolicy, noDeadline: NoDeadlinePolicy, touched: Record<number, string> = {}) {
  const r = rankApplications(apps, TODAY, prio, eff);
  const und = r.undated.map((a) => undatedScore(a, touched[a.id] ?? TODAY, TODAY, prio, eff));
  const o = orderRanking(r.ranked, und, overdue, noDeadline);
  return { ranked: o.ranked.map((s) => s.app.id), flags: o.ranked.map((s) => s.overdue), undated: o.undated.map((u) => u.id) };
}

describe("resolve", () => {
  it("anything unknown falls back to the defaults", () => {
    for (const v of [undefined, null, "", "PIN", "stale", 1, {}, ["pin"]]) expect(resolveOverdue(v)).toBe("pin");
    for (const v of [undefined, null, "", "LAST", "pin", 1, {}, ["last"]]) expect(resolveNoDeadline(v)).toBe("last");
    expect(["pin", "hide", "normal"].map(resolveOverdue)).toEqual(["pin", "hide", "normal"]);
    expect(["stale", "last", "ignore"].map(resolveNoDeadline)).toEqual(["stale", "last", "ignore"]);
  });
});

describe("overdue policies", () => {
  // 1: overdue by one day, no buffers (score -1, not overdue-looking). 2: due today with Big (3) + Heavy (2): score -5, but not overdue.
  const apps = [app(1, "2026-11-11", NONE), app(2, TODAY, BIG, HEAVY), app(3, "2026-11-20", NONE)];
  it("pin: overdue first and flagged, even ahead of a lower non-overdue score", () => {
    expect(order(apps, "pin", "last")).toMatchObject({ ranked: [1, 2, 3], flags: [true, false, false] });
  });
  it("normal: by score, no flag, no pin", () => {
    expect(order(apps, "normal", "last")).toMatchObject({ ranked: [2, 1, 3], flags: [false, false, false] });
  });
  it("hide: overdue left out", () => {
    expect(order(apps, "hide", "last")).toMatchObject({ ranked: [2, 3], flags: [false, false] });
  });
  it("pinned overdue ones keep score order among themselves", () => {
    expect(order([app(1, "2026-11-11", NONE), app(2, "2026-11-01", NONE), app(3, "2026-11-05", BIG)], "pin", "last").ranked).toEqual([2, 3, 1]);
  });
});

describe("no-deadline policies", () => {
  // Undated: 5 has buffers 3+2 = 5, 6 has 3, 7 has 0 (the lowest-priority fallback), 8 has 0.
  const apps = [app(1, "2026-11-30", NONE), app(8, null, NONE), app(7, "soon", null), app(6, "", BIG), app(5, undefined, BIG, HEAVY)];
  it("last: after every dated one, bigger buffers first, then id", () => {
    expect(order(apps, "pin", "last").undated).toEqual([5, 6, 7, 8]);
    expect(order(apps, "pin", "last").ranked).toEqual([1]);
  });
  it("stale: longest untouched first, then id; days are carried", () => {
    const touched = { 5: "2026-11-10", 6: "2026-10-01", 7: "2026-11-12", 8: "2026-11-12" };
    expect(order(apps, "pin", "stale", touched).undated).toEqual([6, 5, 7, 8]);
    expect(undatedScore(app(6, null), "2026-10-01", TODAY, prio, eff)).toMatchObject({ id: 6, daysUntouched: 42, buffer: 0 });
  });
  it("ignore: left out", () => {
    expect(order(apps, "pin", "ignore")).toMatchObject({ ranked: [1], undated: [] });
  });
  it("days untouched never go negative or fail on a bad day", () => {
    expect(undatedScore(app(1, null), "2026-12-01", TODAY, prio, eff).daysUntouched).toBe(0);
    expect(undatedScore(app(1, null), "junk", TODAY, prio, eff).daysUntouched).toBe(0);
  });
});

describe("ranking rules through the database", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
  afterEach(dropTestDb);

  const day = (back: number) => new Date(2026, 10, 12 - back, 12); // local noon, so the zone cannot change the day
  function setup() {
    const tr = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const col = (name: string, type: ColumnType, position: number, isStatus = false) => db.insert(columns).values({ userId: "local", trackId: tr, name, type, position, isStatus }).returning().get().id;
    const status = col("Status", "single_select", 0, true), pr = col("Priority", "single_select", 1), dl = col("Deadline", "date", 2);
    const todo = db.insert(columnOptions).values({ userId: "local", columnId: status, label: "To apply", color: "blue", position: 0 }).returning().get().id;
    const high = db.insert(columnOptions).values({ userId: "local", columnId: pr, label: "High", color: "blue", position: 0, bufferDays: 3 }).returning().get().id;
    const low = db.insert(columnOptions).values({ userId: "local", columnId: pr, label: "Low", color: "blue", position: 1, bufferDays: 0 }).returning().get().id;
    const add = (title: string, deadline: string | null, priority = low, touchedDaysAgo = 0) => {
      const a = db.insert(applications).values({ userId: "local", trackId: tr, title, createdAt: day(60), updatedAt: day(touchedDaysAgo) }).returning().get().id;
      db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: status, valueOptionId: todo }).run();
      db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: pr, valueOptionId: priority }).run();
      if (deadline) db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: dl, valueDate: deadline }).run();
      return a;
    };
    return { add, high, low };
  }
  const titles = async () => { const r = await getPlannerRanking(TODAY); return { ranked: r.ranked.map((x) => x.title), undated: r.undated.map((x) => x.title), flags: r.ranked.map((x) => x.overdue) }; };

  it("never saved = pin and last", async () => {
    expect(await getRankingRules()).toEqual({ overdue: "pin", noDeadline: "last" });
    const { add, high } = setup();
    add("late", "2026-11-11");
    add("big", TODAY, high); // 0 - 3 = -3 beats late's -1 unless pinned
    add("plain", "2026-11-20");
    add("u-low", null);
    add("u-high", null, high);
    expect(await titles()).toEqual({ ranked: ["late", "big", "plain"], undated: ["u-high", "u-low"], flags: [true, false, false] });
  });

  it("each overdue option, through the settings", async () => {
    const { add, high } = setup();
    add("late", "2026-11-11");
    add("big", TODAY, high);
    expect(await setRankingRules("normal", "last")).toEqual({ ok: true });
    expect(await titles()).toMatchObject({ ranked: ["big", "late"], flags: [false, false] });
    await setRankingRules("hide", "last");
    expect(await titles()).toMatchObject({ ranked: ["big"], flags: [false] });
    await setRankingRules("pin", "last");
    expect(await titles()).toMatchObject({ ranked: ["late", "big"], flags: [true, false] });
  });

  it("each no-deadline option, through the settings", async () => {
    const { add, high } = setup();
    add("dated", "2026-11-20");
    add("fresh-high", null, high, 1);
    add("old-low", null, undefined, 30);
    await setRankingRules("pin", "stale");
    expect((await titles()).undated).toEqual(["old-low", "fresh-high"]);
    await setRankingRules("pin", "last");
    expect((await titles()).undated).toEqual(["fresh-high", "old-low"]);
    await setRankingRules("pin", "ignore");
    expect(await titles()).toMatchObject({ ranked: ["dated"], undated: [] });
  });

  it("last touched = the later of updated_at and the newest note or activity event; carried as days", async () => {
    const { add } = setup();
    add("plain", null, undefined, 10);
    const withNote = add("noted", null, undefined, 40);
    const withEvent = add("evented", null, undefined, 50);
    add("oldest", null, undefined, 20);
    db.insert(notes).values({ userId: "local", applicationId: withNote, body: "x", createdAt: day(25) }).run();
    db.insert(notes).values({ userId: "local", applicationId: withNote, body: "y", createdAt: day(2) }).run();
    db.insert(activityEvents).values({ userId: "local", applicationId: withEvent, kind: "status_changed", createdAt: day(5), occurredAt: day(300) }).run();
    await setRankingRules("pin", "stale");
    const r = (await getPlannerRanking(TODAY)).undated;
    expect(r.map((x) => [x.title, x.daysUntouched])).toEqual([["oldest", 20], ["plain", 10], ["evented", 5], ["noted", 2]]);
  });

  it("set refuses unknown values and writes nothing", async () => {
    for (const [o, n] of [["bogus", "last"], ["pin", "bogus"], [undefined, "last"], ["pin", null], ["last", "pin"]]) expect(await setRankingRules(o, n)).toMatchObject({ ok: false });
    expect(await getRankingRules()).toEqual({ overdue: "pin", noDeadline: "last" });
    await setRankingRules("hide", "ignore");
    await setRankingRules("hide", "nope");
    expect(await getRankingRules()).toEqual({ overdue: "hide", noDeadline: "ignore" });
  });

  it("a stored value that is not a policy reads as the default", async () => {
    await setSetting("planner.overdue", "retired");
    await setSetting("planner.no_deadline", 7);
    expect(await getRankingRules()).toEqual({ overdue: "pin", noDeadline: "last" });
  });

  it("the action saves, refreshes only on success", async () => {
    expect(await saveRankingRules("normal", "stale")).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveRankingRules("x", "stale")).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await getRankingRules()).toEqual({ overdue: "normal", noDeadline: "stale" });
  });
});
