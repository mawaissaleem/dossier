import { describe, expect, it } from "vitest";
import { daysLeft, lowestPriorityOption, rankApplications, scoreApplication, type BufferOption, type PlannerApp } from "@/lib/planner";

const PRIORITY = 1, GOOD = 2, HEAVY = 10, LIGHT = 11;
const priorityOpts: BufferOption[] = [{ id: PRIORITY, position: 0, bufferDays: 3 }, { id: GOOD, position: 1, bufferDays: 0 }];
const effortOpts: BufferOption[] = [{ id: HEAVY, position: 0, bufferDays: 2 }, { id: LIGHT, position: 1, bufferDays: 0 }];
const TODAY = "2026-11-12";
const app = (id: number, deadline: unknown, priority: number | null, effort: number | null = null): PlannerApp => ({ id, deadline, priority, effort });
const order = (apps: PlannerApp[], p = priorityOpts, e = effortOpts) => rankApplications(apps, TODAY, p, e).ranked.map((s) => s.app.id);

describe("daysLeft", () => {
  it("counts calendar days", () => {
    expect(daysLeft("2026-11-12", TODAY)).toBe(0);
    expect(daysLeft("2026-11-14", TODAY)).toBe(2);
    expect(daysLeft("2026-11-10", TODAY)).toBe(-2);
  });
  it("crosses month, year and leap-day boundaries", () => {
    expect(daysLeft("2026-12-01", "2026-11-30")).toBe(1);
    expect(daysLeft("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysLeft("2028-03-01", "2028-02-28")).toBe(2); // 2028 is a leap year
    expect(daysLeft("2027-03-01", "2027-02-28")).toBe(1);
    expect(daysLeft("2026-01-01", "2025-01-01")).toBe(365);
  });
  it("is null for blank or invalid values", () => {
    for (const v of [null, undefined, "", "tomorrow", "2026-02-30", "2027-02-29", "2026-13-01", "2026-1-5", 20261114]) expect(daysLeft(v, TODAY)).toBeNull();
    expect(daysLeft("2026-11-14", "nope")).toBeNull();
  });
});

describe("AT-11", () => {
  it("Priority due in 2 days (buffer 3) outranks Good-to-have due in 1 day (buffer 0)", () => {
    const a = app(1, "2026-11-14", PRIORITY);
    const b = app(2, "2026-11-13", GOOD);
    expect(scoreApplication(a, TODAY, priorityOpts, effortOpts)!.score).toBe(-1);
    expect(scoreApplication(b, TODAY, priorityOpts, effortOpts)!.score).toBe(1);
    expect(order([b, a])).toEqual([1, 2]);
  });
  it("with the Priority one due in 6 days the order flips (3 loses to 1)", () => {
    const a = app(1, "2026-11-18", PRIORITY);
    const b = app(2, "2026-11-13", GOOD);
    expect(scoreApplication(a, TODAY, priorityOpts, effortOpts)!.score).toBe(3);
    expect(order([a, b])).toEqual([2, 1]);
  });
  it("flips at the boundary: equal scores tie-break on earlier deadline, then lower id", () => {
    // Priority due in 4 days = 1, Good-to-have due in 1 day = 1: tie, the earlier deadline (Good-to-have) wins
    expect(order([app(1, "2026-11-16", PRIORITY), app(2, "2026-11-13", GOOD)])).toEqual([2, 1]);
    expect(order([app(2, "2026-11-13", GOOD), app(1, "2026-11-16", PRIORITY)])).toEqual([2, 1]);
    // same score, same deadline: lower id first
    expect(order([app(9, "2026-11-13", GOOD), app(4, "2026-11-13", GOOD)])).toEqual([4, 9]);
    // one day further out, the Priority one loses; one day closer, it wins
    expect(order([app(1, "2026-11-17", PRIORITY), app(2, "2026-11-13", GOOD)])).toEqual([2, 1]);
    expect(order([app(1, "2026-11-15", PRIORITY), app(2, "2026-11-13", GOOD)])).toEqual([1, 2]);
  });
  it("changing a buffer in the input changes the order", () => {
    const apps = [app(1, "2026-11-14", PRIORITY), app(2, "2026-11-13", GOOD)];
    expect(order(apps)).toEqual([1, 2]);
    expect(order(apps, [{ id: PRIORITY, position: 0, bufferDays: 0 }, priorityOpts[1]])).toEqual([2, 1]);
  });
});

describe("score parts", () => {
  it("subtracts the effort buffer and reports each part", () => {
    const s = scoreApplication(app(1, "2026-11-14", PRIORITY, HEAVY), TODAY, priorityOpts, effortOpts)!;
    expect(s).toMatchObject({ score: -3, daysLeft: 2, priority: { optionId: PRIORITY, buffer: 3, fallback: false }, effort: { optionId: HEAVY, buffer: 2 } });
  });
  it("effort buffer can change the order", () => {
    const apps = [app(1, "2026-11-15", GOOD, null), app(2, "2026-11-16", GOOD, HEAVY)]; // 3 vs 4-2=2
    expect(order(apps)).toEqual([2, 1]);
  });
  it("missing or unknown effort counts 0; NULL buffers count 0", () => {
    expect(scoreApplication(app(1, "2026-11-14", GOOD, null), TODAY, priorityOpts, effortOpts)!.effort).toEqual({ optionId: null, buffer: 0 });
    expect(scoreApplication(app(1, "2026-11-14", GOOD, 999), TODAY, priorityOpts, effortOpts)!.score).toBe(2);
    expect(scoreApplication(app(1, "2026-11-14", GOOD, HEAVY), TODAY, priorityOpts, [{ id: HEAVY, position: 0, bufferDays: null }])!.score).toBe(2);
    expect(scoreApplication(app(1, "2026-11-14", PRIORITY), TODAY, [{ id: PRIORITY, position: 0, bufferDays: null }], [])!.score).toBe(2);
  });
  it("overdue applications score normally (negative days)", () => {
    const s = scoreApplication(app(1, "2026-11-10", GOOD), TODAY, priorityOpts, effortOpts)!;
    expect(s).toMatchObject({ daysLeft: -2, score: -2 });
  });
});

describe("FR-8.7 no priority", () => {
  it("uses the option with the smallest buffer", () => {
    const s = scoreApplication(app(1, "2026-11-14", null), TODAY, priorityOpts, effortOpts)!;
    expect(s.priority).toEqual({ optionId: GOOD, buffer: 0, fallback: true });
    expect(s.score).toBe(2);
  });
  it("unknown option id is treated as no priority", () => {
    expect(scoreApplication(app(1, "2026-11-14", 999), TODAY, priorityOpts, effortOpts)!.priority.fallback).toBe(true);
  });
  it("ties on the smallest buffer go to the last by position, whatever the array order", () => {
    const opts: BufferOption[] = [{ id: 5, position: 2, bufferDays: null }, { id: 6, position: 0, bufferDays: 0 }, { id: 7, position: 1, bufferDays: 4 }];
    expect(lowestPriorityOption(opts)!.id).toBe(5);
    expect(lowestPriorityOption([...opts].reverse())!.id).toBe(5);
  });
  it("no options (no Priority slot) = buffer 0", () => {
    const s = scoreApplication(app(1, "2026-11-14", null), TODAY, [], [])!;
    expect(s.priority).toEqual({ optionId: null, buffer: 0, fallback: true });
    expect(s.score).toBe(2);
    expect(lowestPriorityOption([])).toBeNull();
  });
});

describe("rankApplications", () => {
  it("returns applications without a valid deadline separately, unranked, in input order", () => {
    const r = rankApplications([app(3, null, PRIORITY), app(1, "2026-11-14", GOOD), app(2, "2026-02-30", GOOD), app(4, "", GOOD)], TODAY, priorityOpts, effortOpts);
    expect(r.ranked.map((s) => s.app.id)).toEqual([1]);
    expect(r.undated.map((a) => a.id)).toEqual([3, 2, 4]);
  });
  it("ranks overdue applications by their negative score", () => {
    expect(order([app(1, "2026-11-13", GOOD), app(2, "2026-11-01", GOOD), app(3, "2026-11-12", GOOD)])).toEqual([2, 3, 1]);
  });
  it("does not change its input", () => {
    const apps = [app(2, "2026-11-20", GOOD), app(1, "2026-11-13", GOOD)];
    rankApplications(apps, TODAY, priorityOpts, effortOpts);
    expect(apps.map((a) => a.id)).toEqual([2, 1]);
  });
  it("refuses an invalid today", () => {
    expect(() => rankApplications([], "yesterday", priorityOpts, effortOpts)).toThrow();
  });
});
