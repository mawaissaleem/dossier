import { describe, expect, it } from "vitest";
import {
  deadlineTile,
  itemsInRow,
  overdueTile,
  splitValue,
  upNext,
  weekHint,
  type OverdueAlert,
  type UpcomingDeadline,
} from "@/lib/dashboard";

const late = (id: number, days: number, title = `App ${id}`): OverdueAlert => ({
  id,
  title,
  trackId: 1,
  trackName: "PhD",
  date: "1 Nov 2026",
  days,
  text: "",
});
const next = (text: string): UpcomingDeadline => ({
  id: 1,
  title: "Robotics Lab",
  trackId: 1,
  trackName: "PhD",
  date: "20 Nov 2026",
  days: 3,
  big: "3",
  unit: "days",
  text,
});

describe("overdueTile (pure)", () => {
  it("is calm with nothing overdue", () => {
    expect(overdueTile([])).toEqual({ value: "0", hint: "Nothing late", alert: false });
  });
  it("names the most overdue item, its lateness and how many more", () => {
    expect(overdueTile([late(1, 2, "X")])).toEqual({ value: "1", hint: "PhD · X, 2 days late", alert: true });
    expect(overdueTile([late(1, 1, "X"), late(2, 1), late(3, 1)])).toEqual({
      value: "3",
      hint: "PhD · X, 1 day late · +2 more",
      alert: true,
    });
  });
});

describe("deadlineTile (pure)", () => {
  it("shows the nearest deadline's phrase over track and title", () => {
    expect(deadlineTile(next("3 days"))).toEqual({ value: "3 days", hint: "PhD · Robotics Lab" });
    expect(deadlineTile(next("Today")).value).toBe("Today");
  });
  it("says none when there is nothing upcoming", () => {
    expect(deadlineTile(undefined)).toEqual({ value: "None", hint: "No upcoming deadlines" });
  });
});

describe("weekHint (pure)", () => {
  const p = { count: 1, capacity: 4, met: false, streak: 0 };
  it("says how many more to start or extend a streak", () => {
    expect(weekHint(p)).toBe("3 more to start a streak");
    expect(weekHint({ ...p, streak: 2 })).toBe("2-week streak · 3 more to extend the streak");
  });
  it("says the goal is met, with the streak when there is one", () => {
    expect(weekHint({ ...p, count: 4, met: true })).toBe("Weekly goal met");
    expect(weekHint({ ...p, count: 5, met: true, streak: 3 })).toBe("Goal met · 3-week streak");
  });
});

describe("splitValue (pure)", () => {
  it("the first word is the big part, the rest a muted unit", () => {
    expect(splitValue("3 days")).toEqual({ big: "3", unit: " days" });
    expect(splitValue("1 of 4")).toEqual({ big: "1", unit: " of 4" });
    expect(splitValue("Today")).toEqual({ big: "Today", unit: "" });
    expect(splitValue("")).toEqual({ big: "", unit: "" });
  });
});

describe("itemsInRow (pure)", () => {
  it("full rows have perRow items; an incomplete last row's items share it, so no cell is empty", () => {
    const row = (n: number, per: number) => Array.from({ length: n }, (_, i) => itemsInRow(i, n, per));
    expect(row(3, 3)).toEqual([3, 3, 3]);
    expect(row(4, 3)).toEqual([3, 3, 3, 1]);
    expect(row(5, 3)).toEqual([3, 3, 3, 2, 2]);
    expect(row(3, 2)).toEqual([2, 2, 1]);
    expect(row(1, 3)).toEqual([1]);
    expect(row(2, 3)).toEqual([2, 2]);
  });
});

describe("upNext (pure)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it("takes the first `limit` after the plan, numbered on from it, and says when there are more", () => {
    expect(upNext(ids(4), ids(30), 12)).toEqual({ shown: ids(12), start: 5, total: 34, more: true });
  });
  it("shows all of a short rest with no link", () => {
    expect(upNext(ids(4), ids(3), 12)).toEqual({ shown: [1, 2, 3], start: 5, total: 7, more: false });
    expect(upNext(ids(4), ids(12), 12)).toMatchObject({ shown: ids(12), more: false }); // exactly the limit: nothing left out
  });
  it("is empty when everything fits in the plan", () => {
    expect(upNext(ids(2), [], 12)).toEqual({ shown: [], start: 3, total: 2, more: false });
    expect(upNext([], [], 12)).toEqual({ shown: [], start: 1, total: 0, more: false });
  });
});
