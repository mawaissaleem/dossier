import { describe, expect, it } from "vitest";
import { pipelineCounts } from "@/lib/pipeline";
import { ATTENTION_DAYS, STALE_DAYS, overviewSummary, relativeTime, trackOverview, type OverviewApp } from "@/lib/track-overview";

const DAY = 86_400_000;
const TODAY = "2026-11-17";
const NOW = Date.UTC(2026, 10, 17, 12);
const [TODO, APPLIED, INTERVIEW, OFFER] = [1, 2, 3, 4];
const opts = [{ id: TODO, label: "To apply", color: "gray" }, { id: APPLIED, label: "Applied", color: "blue" }, { id: INTERVIEW, label: "Interview", color: "teal" }, { id: OFFER, label: "Offer", color: "green" }];
const pipeline = (apps: OverviewApp[]) => pipelineCounts(apps.map((a) => ({ trackId: 7, optionId: a.statusId, n: 1 })), [{ id: 7, name: "Job", statusColumnId: 70, options: opts }])[0];
const app = (id: number, o: Partial<OverviewApp> = {}): OverviewApp => ({ id, title: `a${id}`, statusId: TODO, touchedMs: NOW - DAY, deadline: null, firstSubmitted: null, ...o });
const over = (apps: OverviewApp[]) => trackOverview({ pipeline: pipeline(apps), todoIds: [TODO], submittedIds: [APPLIED], winIds: [INTERVIEW, OFFER], apps }, TODAY, NOW);
const dayStr = (offset: number) => new Date(Date.UTC(2026, 10, 17 + offset)).toISOString().slice(0, 10);

describe("relativeTime", () => {
  it.each([
    [10_000, "just now"], [90_000, "1 minute ago"], [5 * 60_000, "5 minutes ago"], [3_600_000, "1 hour ago"], [5 * 3_600_000, "5 hours ago"],
    [30 * 3_600_000, "yesterday"], [3 * DAY, "3 days ago"], [13 * DAY, "13 days ago"], [14 * DAY, "2 weeks ago"], [59 * DAY, "8 weeks ago"], [60 * DAY, "2 months ago"], [400 * DAY, "13 months ago"],
  ])("%d ms ago reads %s", (ago, text) => expect(relativeTime(NOW - ago, NOW)).toBe(text));
  it("a future time reads just now", () => expect(relativeTime(NOW + DAY, NOW)).toBe("just now"));
});

describe("trackOverview: counts", () => {
  it("empty track: zeros, no rate, nothing recent or to attend to", () => {
    const o = over([]);
    expect(o).toMatchObject({ total: 0, toApply: 0, submitted: 0, wins: 0, winRate: null, submittedThisMonth: 0, updatedMs: null, recent: [], attention: [] });
  });
  it("counts by the three status sets; the total includes statuses in none of them", () => {
    const o = over([app(1), app(2), app(3, { statusId: APPLIED }), app(4, { statusId: INTERVIEW }), app(5, { statusId: null })]);
    expect([o.total, o.toApply, o.submitted, o.wins]).toEqual([5, 2, 1, 1]);
  });
  it("win rate is a whole percent of the applications that reached a submitted or win status (no divide by zero)", () => {
    expect(over([app(1)]).winRate).toBeNull();
    expect(over([app(1, { statusId: APPLIED }), app(2, { statusId: APPLIED }), app(3, { statusId: OFFER })]).winRate).toBe(33);
    expect(over([app(1, { statusId: OFFER })]).winRate).toBe(100);
  });
  it("an option in both the submitted and the win set is counted once in the rate", () => {
    const apps = [app(1, { statusId: INTERVIEW }), app(2, { statusId: APPLIED })];
    const o = trackOverview({ pipeline: pipeline(apps), todoIds: [TODO], submittedIds: [APPLIED, INTERVIEW], winIds: [INTERVIEW], apps }, TODAY, NOW);
    expect(o.winRate).toBe(50);
  });
  it("submitted this month = first submission in the current month, whatever the status", () => {
    const o = over([app(1, { firstSubmitted: "2026-11-02" }), app(2, { firstSubmitted: "2026-10-31" }), app(3, { firstSubmitted: "2025-11-05" }), app(4)]);
    expect(o.submittedThisMonth).toBe(1);
  });
  it("refuses an invalid today", () => {
    expect(() => trackOverview({ pipeline: pipeline([]), todoIds: [], submittedIds: [], winIds: [], apps: [] }, "nope", NOW)).toThrow();
  });
});

describe("trackOverview: recently updated", () => {
  it("the 3 most recently touched, newest first (ties: higher id), with their status label", () => {
    const o = over([app(1, { touchedMs: NOW - 5 * DAY }), app(2, { touchedMs: NOW - 1 * DAY, statusId: APPLIED }), app(3, { touchedMs: NOW - 3 * DAY }), app(4, { touchedMs: NOW - 1 * DAY, statusId: null }), app(5, { touchedMs: NOW - 9 * DAY })]);
    expect(o.recent.map((r) => [r.id, r.status])).toEqual([[4, null], [2, "Applied"], [3, "To apply"]]);
    expect(o.updatedMs).toBe(NOW - DAY);
    expect([o.updated, o.recent[0].when, o.recent[2].when]).toEqual(["yesterday", "yesterday", "3 days ago"]);
  });
  it("fewer than 3 applications gives fewer rows", () => expect(over([app(1)]).recent).toHaveLength(1));
});

describe("trackOverview: needs attention", () => {
  it("deadlines within the window, soonest first, overdue first of all; later, undated and not-still-to-do are left out", () => {
    const o = over([
      app(1, { deadline: dayStr(5) }), app(2, { deadline: dayStr(0) }), app(3, { deadline: dayStr(-2) }), app(4, { deadline: dayStr(1) }),
      app(5, { deadline: dayStr(ATTENTION_DAYS) }), app(6, { deadline: dayStr(ATTENTION_DAYS + 1) }), app(7), app(8, { deadline: dayStr(1), statusId: APPLIED, touchedMs: NOW }),
    ]);
    expect(o.attention.map((a) => [a.id, a.when, a.tone])).toEqual([
      [3, "2 days late", "overdue"], [2, "Today", "warning"], [4, "Tomorrow", "warning"], [1, "In 5 days", "muted"], [5, `In ${ATTENTION_DAYS} days`, "muted"],
    ]);
    expect(o.attention[0].kind).toBe("Deadline");
  });
  it("1 day late is singular", () => expect(over([app(1, { deadline: dayStr(-1) })]).attention[0].when).toBe("1 day late"));
  it("submitted, not a win and untouched for the threshold: stalest first, after the deadlines, destructive", () => {
    const o = over([
      app(1, { statusId: APPLIED, touchedMs: NOW - STALE_DAYS * DAY }), app(2, { statusId: APPLIED, touchedMs: NOW - (STALE_DAYS - 1) * DAY }),
      app(3, { statusId: APPLIED, touchedMs: NOW - 40 * DAY }), app(4, { statusId: INTERVIEW, touchedMs: NOW - 90 * DAY }), app(5, { touchedMs: NOW - 90 * DAY }),
      app(6, { deadline: dayStr(3) }),
    ]);
    expect(o.attention.map((a) => [a.id, a.kind, a.when, a.tone])).toEqual([
      [6, "Deadline", "In 3 days", "muted"], [3, "No update since submitting", "40 days", "overdue"], [1, "No update since submitting", `${STALE_DAYS} days`, "overdue"],
    ]);
  });
  it("an application in both sets (overlapping settings) is listed once, as a deadline", () => {
    const apps = [app(1, { statusId: APPLIED, deadline: dayStr(2), touchedMs: NOW - 30 * DAY })];
    const o = trackOverview({ pipeline: pipeline(apps), todoIds: [TODO, APPLIED], submittedIds: [APPLIED], winIds: [], apps }, TODAY, NOW);
    expect(o.attention.map((a) => a.kind)).toEqual(["Deadline"]);
  });
  it("nothing to attend to is an empty list", () => expect(over([app(1, { deadline: dayStr(60) })]).attention).toEqual([]));
});

describe("overviewSummary", () => {
  it("tracks, applications and how many need attention, with singulars", () => {
    expect(overviewSummary([{ total: 7, attention: [1, 2, 3] as never }, { total: 4, attention: [1] as never }])).toBe("2 tracks · 11 applications · 4 need attention");
    expect(overviewSummary([{ total: 1, attention: [1] as never }])).toBe("1 track · 1 application · 1 needs attention");
    expect(overviewSummary([])).toBe("0 tracks · 0 applications · 0 need attention");
  });
});
