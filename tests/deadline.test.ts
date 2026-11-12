import { describe, expect, it } from "vitest";
import { deadlineInfo, localToday } from "@/lib/deadline";
import { cardColumns } from "@/lib/board";

const rel = (v: unknown, today: string) => deadlineInfo(v, today)?.relative;

describe("deadlineInfo", () => {
  it("today, tomorrow, yesterday", () => {
    expect(deadlineInfo("2026-11-12", "2026-11-12")).toEqual({ date: "12 Nov 2026", relative: "today", overdue: false });
    expect(rel("2026-11-13", "2026-11-12")).toBe("tomorrow");
    expect(deadlineInfo("2026-11-11", "2026-11-12")).toEqual({ date: "11 Nov 2026", relative: "yesterday", overdue: true });
  });
  it("future and past in days; only the past is overdue", () => {
    expect(deadlineInfo("2026-11-15", "2026-11-12")).toMatchObject({ relative: "in 3 days", overdue: false });
    expect(deadlineInfo("2026-11-10", "2026-11-12")).toMatchObject({ relative: "2 days ago", overdue: true });
    expect(rel("2027-11-12", "2026-11-12")).toBe("in 365 days");
    expect(rel("2026-01-01", "2026-11-12")).toBe("315 days ago");
  });
  it("counts across month, year and leap-day boundaries", () => {
    expect(rel("2026-12-01", "2026-11-30")).toBe("tomorrow");
    expect(rel("2027-01-01", "2026-12-31")).toBe("tomorrow");
    expect(rel("2026-12-31", "2027-01-01")).toBe("yesterday");
    expect(rel("2028-03-01", "2028-02-28")).toBe("in 2 days"); // 2028 is a leap year
    expect(rel("2027-03-01", "2027-02-28")).toBe("tomorrow");
  });
  it("blank or invalid values give null so the card omits the line", () => {
    for (const v of [null, undefined, "", "  ", "2026-13-01", "2026-02-30", "12/11/2026", "2026-1-5", 20261112, true]) expect(deadlineInfo(v, "2026-11-12")).toBeNull();
  });
  it("no known today (server render) gives the date alone, never overdue", () => {
    expect(deadlineInfo("2020-01-01", null)).toEqual({ date: "1 Jan 2020", relative: null, overdue: false });
    expect(deadlineInfo("2020-01-01", "garbage")).toEqual({ date: "1 Jan 2020", relative: null, overdue: false });
  });
});

describe("localToday", () => {
  it("is the local calendar day, zero padded", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localToday(new Date(2026, 10, 12, 0, 0))).toBe("2026-11-12");
  });
});

describe("cardColumns", () => {
  const c = (name: string, type: "single_select" | "date" | "text", hidden = false) => ({ name, type, hidden });
  it("picks Priority and Deadline by trimmed, case-insensitive name and type", () => {
    const cols = [c("Status", "single_select"), c(" PRIORITY ", "single_select"), c("deadline", "date")];
    expect(cardColumns(cols)).toEqual({ priority: cols[1], deadline: cols[2] });
  });
  it("takes the first match, skips hidden columns, requires the right type", () => {
    const cols = [c("Priority", "single_select", true), c("Priority", "single_select"), c("Priority", "single_select"), c("Deadline", "text"), c("Deadline", "date"), c("Deadline", "date")];
    expect(cardColumns(cols)).toEqual({ priority: cols[1], deadline: cols[4] });
  });
  it("a track without them has neither", () => {
    expect(cardColumns([c("Status", "single_select"), c("Due", "date")])).toEqual({ priority: undefined, deadline: undefined });
  });
});
