import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countInWeek, streak, weekRange, weekStart, weeklyProgress } from "@/lib/dashboard";
import { setCapacity, getWeeklyProgress } from "@/lib/db/planner";
import { applications, submissions, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

describe("weekStart / weekRange (pure)", () => {
  it("Monday and Sunday edges", () => {
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(weekStart("2026-11-12")).toBe("2026-11-09"); // Thursday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // next Monday
    expect(weekRange("2026-11-15")).toEqual({ start: "2026-11-09", end: "2026-11-15", label: "9–15 Nov" });
  });
  it("crosses months and years (ISO week across Dec/Jan)", () => {
    expect(weekRange("2026-12-31")).toEqual({ start: "2026-12-28", end: "2027-01-03", label: "28 Dec 2026 – 3 Jan 2027" });
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(weekRange("2026-12-02").label).toBe("30 Nov – 6 Dec");
    expect(weekStart("2024-02-29")).toBe("2024-02-26"); // leap day
    expect(weekStart("1969-12-24")).toBe("1969-12-22"); // before 1970 (Wednesday)
    expect(weekStart("1969-12-22")).toBe("1969-12-22");
  });
  it("refuses an invalid day", () => {
    expect(() => weekStart("nope")).toThrow();
    expect(() => weekRange("2026-02-30")).toThrow();
    expect(() => countInWeek([], "x")).toThrow();
  });
});

describe("countInWeek / weeklyProgress (pure)", () => {
  const TODAY = "2026-11-12";
  it("counts first-submission dates inside the week only, edges included", () => {
    expect(countInWeek(["2026-11-08", "2026-11-09", "2026-11-15", "2026-11-16", "bad"], "2026-11-09")).toBe(2);
  });
  it("a first submission in an earlier week is not counted now; a later re-submission is not an input", () => {
    expect(weeklyProgress(["2026-11-02"], 4, TODAY).count).toBe(0);
  });
  it("future-dated: later this week counts, next week does not", () => {
    expect(weeklyProgress(["2026-11-14", "2026-11-15"], 4, TODAY).count).toBe(2);
    expect(weeklyProgress(["2026-11-16"], 4, TODAY).count).toBe(0);
  });
  it("partial, met and over capacity (5 of 4: ratio capped, count not)", () => {
    const d = (n: number) => Array(n).fill("2026-11-10");
    expect(weeklyProgress(d(0), 4, TODAY)).toMatchObject({ count: 0, ratio: 0, met: false });
    expect(weeklyProgress(d(3), 4, TODAY)).toMatchObject({ count: 3, capacity: 4, ratio: 0.75, met: false, label: "9–15 Nov" });
    expect(weeklyProgress(d(4), 4, TODAY)).toMatchObject({ count: 4, ratio: 1, met: true });
    expect(weeklyProgress(d(5), 4, TODAY)).toMatchObject({ count: 5, ratio: 1, met: true });
  });
  it("year boundary: a Jan date is in the Dec-starting week", () => {
    expect(weeklyProgress(["2027-01-02", "2026-12-28"], 4, "2026-12-31").count).toBe(2);
  });
});

describe("streak (pure)", () => {
  const TODAY = "2026-11-12"; // Thursday; this week starts 2026-11-09
  const CAP = 2;
  // Two submissions in each week `k` weeks back (k = 0 is this week); k = -1 is next week.
  const weeks = (ks: number[], per = CAP) => ks.flatMap((k) => Array(per).fill(dayStringFor(-7 * k)));
  const dayStringFor = (offset: number) => new Date(Date.UTC(2026, 10, 10) + offset * 86_400_000).toISOString().slice(0, 10); // a Tuesday
  const run = (dates: string[], cap = CAP, today = TODAY, max?: number) => streak(dates, cap, today, max);

  it("no submissions: 0", () => expect(run([])).toEqual({ weeks: 0, thisWeekMet: false }));
  it("only this week met: 1", () => expect(run(weeks([0]))).toEqual({ weeks: 1, thisWeekMet: true }));
  it("last 3 weeks met, this week not yet: 3 (not broken)", () => {
    expect(run(weeks([1, 2, 3]))).toEqual({ weeks: 3, thisWeekMet: false });
    expect(run([...weeks([1, 2, 3]), dayStringFor(0)])).toEqual({ weeks: 3, thisWeekMet: false }); // 1 of 2 this week
  });
  it("last 3 met and this week met: 4", () => expect(run(weeks([0, 1, 2, 3]))).toEqual({ weeks: 4, thisWeekMet: true }));
  it("a week below capacity ends it", () => {
    expect(run(weeks([1, 2, 4, 5]))).toMatchObject({ weeks: 2 });
    expect(run([...weeks([1, 3]), dayStringFor(-14)])).toMatchObject({ weeks: 1 }); // week 2 has 1 of 2
  });
  it("future-dated (next week and later) is ignored", () => {
    expect(run(weeks([-1, -2]))).toEqual({ weeks: 0, thisWeekMet: false });
    expect(run([...weeks([1]), ...weeks([-1])])).toEqual({ weeks: 1, thisWeekMet: false });
  });
  it("later this week counts toward this week", () => {
    expect(run(["2026-11-14", "2026-11-15"])).toEqual({ weeks: 1, thisWeekMet: true });
  });
  it("crosses the year boundary", () => {
    // today 2027-01-05 (Tuesday); weeks starting 2026-12-28, 2026-12-21, 2026-12-14 are last week and before
    expect(run(["2026-12-29", "2027-01-02", "2026-12-22", "2026-12-24", "2026-12-15", "2026-12-16"], 2, "2027-01-05")).toEqual({ weeks: 3, thisWeekMet: false });
    expect(run(["2027-01-04", "2027-01-05"], 2, "2027-01-05")).toEqual({ weeks: 1, thisWeekMet: true });
  });
  it("judges past weeks against the capacity given (the current one)", () => {
    const d = weeks([1, 2, 3], 2);
    expect(run(d, 2).weeks).toBe(3);
    expect(run(d, 3).weeks).toBe(0); // raised: the same history no longer counts
    expect(run(d, 1).weeks).toBe(3);
  });
  it("the look-back is capped", () => {
    const d = weeks(Array.from({ length: 600 }, (_, i) => i + 1), 1);
    expect(run(d, 1).weeks).toBe(520);
    expect(run(d, 1, TODAY, 10).weeks).toBe(10);
    expect(run([...d, dayStringFor(0)], 1).weeks).toBe(521); // plus this week
  });
  // The bound only catches a runaway (quadratic) walk over 5000 dates, which would take many seconds; a loaded CI machine stays far below 2 s.
  it("is fast on a long history", () => {
    const d = weeks(Array.from({ length: 5000 }, (_, i) => i), 1);
    const t = performance.now();
    run(d, 1);
    expect(performance.now() - t).toBeLessThan(2000);
  });
  it("re-submissions are not an input: one date per application", () => {
    // 1 application with a first date this week is 1 of 2: not met, however many times it was re-submitted
    expect(run(["2026-11-10"]).thisWeekMet).toBe(false);
  });
  it("ignores invalid dates and refuses a bad today", () => {
    expect(run(["bad", "2026-02-30"])).toEqual({ weeks: 0, thisWeekMet: false });
    expect(() => streak([], 2, "x")).toThrow();
  });
});

describe("getWeeklyProgress (data layer)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);
  const TODAY = "2026-11-12";

  const track = () => db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  const app = (t: number, archived = false) => db.insert(applications).values({ userId: "local", trackId: t, title: "x", archived }).returning().get().id;
  const sub = (a: number, date: string) => db.insert(submissions).values({ userId: "local", applicationId: a, date }).run();

  it("nothing submitted: 0 of the default capacity 4", async () => {
    expect(await getWeeklyProgress(TODAY)).toMatchObject({ count: 0, capacity: 4, ratio: 0, met: false, streak: 0 });
  });

  it("counts each application once, by its first submission; archived and other weeks are out", async () => {
    const t = track();
    const a = app(t), b = app(t), c = app(t), old = app(t), arch = app(t, true);
    sub(a, "2026-11-10"); sub(a, "2026-11-11"); // re-submission same week: once
    sub(b, "2026-11-02"); sub(b, "2026-11-11"); // first was last week: not this week
    sub(c, "2026-11-15"); // Sunday, later this week
    sub(old, "2026-11-16"); // next week
    sub(arch, "2026-11-10");
    const r = await getWeeklyProgress(TODAY);
    expect(r).toMatchObject({ count: 2, capacity: 4, ratio: 0.5, met: false, label: "9–15 Nov" });
    expect(r.streak).toBe(0);
  });

  it("uses the saved capacity; over capacity is met", async () => {
    const t = track();
    await setCapacity(1);
    sub(app(t), "2026-11-09"); sub(app(t), "2026-11-12");
    expect(await getWeeklyProgress(TODAY)).toMatchObject({ count: 2, capacity: 1, ratio: 1, met: true });
  });

  it("streak: from the same first dates, current capacity, re-submissions and archived apps change nothing", async () => {
    const t = track();
    await setCapacity(2);
    // Last two weeks (2026-11-02, 2026-10-26) and this week each have 2 applications first submitted in them.
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-03", "2026-11-04", "2026-10-27", "2026-10-28"]) sub(app(t), d);
    const again = app(t); sub(again, "2026-10-20"); sub(again, "2026-10-21"); // 1 of 2 that week: ends it
    sub(app(t, true), "2026-10-20"); // archived: does not help
    expect(await getWeeklyProgress(TODAY)).toMatchObject({ count: 2, met: true, streak: 3 });
    await setCapacity(3);
    expect((await getWeeklyProgress(TODAY)).streak).toBe(0);
  });
});
