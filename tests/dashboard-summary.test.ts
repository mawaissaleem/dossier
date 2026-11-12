import { describe, expect, it } from "vitest";
import { summaryLine } from "@/lib/dashboard";

const base = { overdue: 0, nextDays: null, count: 0, capacity: 4 };

describe("summaryLine (pure)", () => {
  it("names the weekday and the date, then everything that applies", () => {
    expect(summaryLine("2026-11-12", { overdue: 2, nextDays: 3, count: 1, capacity: 4 })).toBe("Thursday 12 November · 2 overdue · next deadline in 3 days · 1 of 4 this week");
  });
  it("leaves out overdue when none and the deadline when there is none", () => {
    expect(summaryLine("2026-11-12", base)).toBe("Thursday 12 November · 0 of 4 this week");
  });
  it("today and tomorrow read as words", () => {
    expect(summaryLine("2026-11-12", { ...base, nextDays: 0 })).toContain("next deadline today");
    expect(summaryLine("2026-11-12", { ...base, nextDays: 1 })).toContain("next deadline tomorrow");
  });
  it("weekdays and months across the week and the year", () => {
    expect(summaryLine("2026-11-09", base).startsWith("Monday 9 November")).toBe(true);
    expect(summaryLine("2026-11-15", base).startsWith("Sunday 15 November")).toBe(true);
    expect(summaryLine("2027-01-01", base).startsWith("Friday 1 January")).toBe(true);
    expect(summaryLine("1969-12-31", base).startsWith("Wednesday 31 December")).toBe(true);
  });
  it("refuses a bad today", () => {
    expect(() => summaryLine("nope", base)).toThrow();
  });
});
