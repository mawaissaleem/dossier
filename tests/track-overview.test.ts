import { describe, expect, it } from "vitest";
import { pipelineCounts } from "@/lib/pipeline";
import {
  ACTIVE_DAYS,
  ATTENTION_DAYS,
  STALE_DAYS,
  attentionLine,
  overviewSummary,
  parseTrackSort,
  relativeTime,
  sortTracks,
  trackOverview,
  type OverviewApp,
} from "@/lib/track-overview";

const DAY = 86_400_000;
const TODAY = "2026-11-17";
const NOW = Date.UTC(2026, 10, 17, 12);
const [TODO, APPLIED, INTERVIEW, OFFER] = [1, 2, 3, 4];
const opts = [
  { id: TODO, label: "To apply", color: "gray" },
  { id: APPLIED, label: "Applied", color: "blue" },
  { id: INTERVIEW, label: "Interview", color: "teal" },
  { id: OFFER, label: "Offer", color: "green" },
];
const pipeline = (apps: OverviewApp[]) =>
  pipelineCounts(
    apps.map((a) => ({ trackId: 7, optionId: a.statusId, n: 1 })),
    [{ id: 7, name: "Job", color: "blue", statusColumnId: 70, options: opts }],
  )[0];
const app = (id: number, o: Partial<OverviewApp> = {}): OverviewApp => ({
  id,
  title: `a${id}`,
  statusId: TODO,
  touchedMs: NOW - DAY,
  deadline: null,
  ...o,
});
const over = (apps: OverviewApp[]) =>
  trackOverview(
    { pipeline: pipeline(apps), todoIds: [TODO], submittedIds: [APPLIED], winIds: [INTERVIEW, OFFER], apps },
    TODAY,
    NOW,
  );
const dayStr = (offset: number) => new Date(Date.UTC(2026, 10, 17 + offset)).toISOString().slice(0, 10);

describe("relativeTime", () => {
  it.each([
    [10_000, "just now"],
    [90_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [3_600_000, "1 hour ago"],
    [5 * 3_600_000, "5 hours ago"],
    [30 * 3_600_000, "yesterday"],
    [3 * DAY, "3 days ago"],
    [13 * DAY, "13 days ago"],
    [14 * DAY, "2 weeks ago"],
    [59 * DAY, "8 weeks ago"],
    [60 * DAY, "2 months ago"],
    [400 * DAY, "13 months ago"],
  ])("%d ms ago reads %s", (ago, text) => expect(relativeTime(NOW - ago, NOW)).toBe(text));
  it("a future time reads just now", () => expect(relativeTime(NOW + DAY, NOW)).toBe("just now"));
});

describe("trackOverview: counts", () => {
  it("empty track: zeros, never updated, nothing to attend to", () => {
    const o = over([]);
    expect(o).toMatchObject({
      total: 0,
      toApply: 0,
      submitted: 0,
      wins: 0,
      updatedMs: null,
      attention: [],
      overdue: 0,
      nextDeadlineDays: null,
      activeCount: 0,
    });
  });
  it("counts by the three status sets; the total includes statuses in none of them", () => {
    const o = over([
      app(1),
      app(2),
      app(3, { statusId: APPLIED }),
      app(4, { statusId: INTERVIEW }),
      app(5, { statusId: null }),
    ]);
    expect([o.total, o.toApply, o.submitted, o.wins]).toEqual([5, 2, 1, 1]);
  });
  it("refuses an invalid today", () => {
    expect(() =>
      trackOverview({ pipeline: pipeline([]), todoIds: [], submittedIds: [], winIds: [], apps: [] }, "nope", NOW),
    ).toThrow();
  });
});

describe("trackOverview: updated and active", () => {
  it("updated = the newest touch of any application, in words; the track's colour comes with it", () => {
    const o = over([
      app(1, { touchedMs: NOW - 5 * DAY }),
      app(2, { touchedMs: NOW - DAY }),
      app(3, { touchedMs: NOW - 9 * DAY }),
    ]);
    expect([o.updatedMs, o.updated, o.color]).toEqual([NOW - DAY, "yesterday", "blue"]);
  });
  it("active = applications touched within the last ACTIVE_DAYS days (the boundary day counts)", () => {
    const o = over([
      app(1, { touchedMs: NOW }),
      app(2, { touchedMs: NOW - ACTIVE_DAYS * DAY }),
      app(3, { touchedMs: NOW - ACTIVE_DAYS * DAY - 1 }),
    ]);
    expect(o.activeCount).toBe(2);
  });
});

describe("trackOverview: needs attention", () => {
  it("deadlines within the window, soonest first, overdue first of all; later, undated and not-still-to-do are left out", () => {
    const o = over([
      app(1, { deadline: dayStr(5) }),
      app(2, { deadline: dayStr(0) }),
      app(3, { deadline: dayStr(-2) }),
      app(4, { deadline: dayStr(1) }),
      app(5, { deadline: dayStr(ATTENTION_DAYS) }),
      app(6, { deadline: dayStr(ATTENTION_DAYS + 1) }),
      app(7),
      app(8, { deadline: dayStr(1), statusId: APPLIED, touchedMs: NOW }),
    ]);
    expect(o.attention.map((a) => [a.id, a.when, a.tone])).toEqual([
      [3, "2 days late", "overdue"],
      [2, "Today", "warning"],
      [4, "Tomorrow", "warning"],
      [1, "In 5 days", "muted"],
      [5, `In ${ATTENTION_DAYS} days`, "muted"],
    ]);
    expect(o.attention[0].kind).toBe("Deadline");
  });
  it("1 day late is singular", () =>
    expect(over([app(1, { deadline: dayStr(-1) })]).attention[0].when).toBe("1 day late"));
  it("submitted, not a win and untouched for the threshold: stalest first, after the deadlines, destructive", () => {
    const o = over([
      app(1, { statusId: APPLIED, touchedMs: NOW - STALE_DAYS * DAY }),
      app(2, { statusId: APPLIED, touchedMs: NOW - (STALE_DAYS - 1) * DAY }),
      app(3, { statusId: APPLIED, touchedMs: NOW - 40 * DAY }),
      app(4, { statusId: INTERVIEW, touchedMs: NOW - 90 * DAY }),
      app(5, { touchedMs: NOW - 90 * DAY }),
      app(6, { deadline: dayStr(3) }),
    ]);
    expect(o.attention.map((a) => [a.id, a.kind, a.when, a.tone])).toEqual([
      [6, "Deadline", "In 3 days", "muted"],
      [3, "No update since submitting", "40 days", "overdue"],
      [1, "No update since submitting", `${STALE_DAYS} days`, "overdue"],
    ]);
  });
  it("an application in both sets (overlapping settings) is listed once, as a deadline", () => {
    const apps = [app(1, { statusId: APPLIED, deadline: dayStr(2), touchedMs: NOW - 30 * DAY })];
    const o = trackOverview(
      { pipeline: pipeline(apps), todoIds: [TODO, APPLIED], submittedIds: [APPLIED], winIds: [], apps },
      TODAY,
      NOW,
    );
    expect(o.attention.map((a) => a.kind)).toEqual(["Deadline"]);
  });
  it("nothing to attend to is an empty list", () =>
    expect(over([app(1, { deadline: dayStr(60) })]).attention).toEqual([]));
});

describe("trackOverview: overdue and next deadline", () => {
  it("overdue counts only still-to-do deadlines before today; next deadline is the nearest one from today on, however far", () => {
    const o = over([
      app(1, { deadline: dayStr(-3) }),
      app(2, { deadline: dayStr(-1) }),
      app(3, { deadline: dayStr(90) }),
      app(4, { deadline: dayStr(40) }),
      app(5, { deadline: dayStr(-9), statusId: APPLIED }),
    ]);
    expect([o.overdue, o.nextDeadlineDays]).toEqual([2, 40]);
  });
  it("today is a next deadline of 0 days, not overdue; none at all is null", () => {
    expect(over([app(1, { deadline: dayStr(0) })])).toMatchObject({ overdue: 0, nextDeadlineDays: 0 });
    expect(over([app(1), app(2, { deadline: dayStr(-1) })]).nextDeadlineDays).toBeNull();
  });
  it("a stale submitted application needs attention but is not overdue", () => {
    expect(over([app(1, { statusId: APPLIED, touchedMs: NOW - 40 * DAY })])).toMatchObject({
      overdue: 0,
      attention: [{ id: 1 }],
    });
  });
});

describe("attentionLine", () => {
  const line = (o: Partial<Parameters<typeof attentionLine>[0]>) =>
    attentionLine({ total: 5, attention: [], overdue: 0, nextDeadlineDays: null, ...o });
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i, title: "", kind: "", when: "", tone: "muted" as const }));
  it("overdue first (the red part), then how many more need attention", () => {
    expect(line({ overdue: 1, attention: items(3) })).toEqual({ alert: "1 overdue", text: "2 more need attention" });
    expect(line({ overdue: 2, attention: items(3) })).toEqual({ alert: "2 overdue", text: "1 more needs attention" });
  });
  it("overdue alone says only that; with a next deadline it adds it", () => {
    expect(line({ overdue: 2, attention: items(2) })).toEqual({ alert: "2 overdue", text: "" });
    expect(line({ overdue: 1, attention: items(1), nextDeadlineDays: 11 })).toEqual({
      alert: "1 overdue",
      text: "next deadline in 11 days",
    });
  });
  it("nothing overdue: the count of those that need attention, else the next deadline, else calm text", () => {
    expect(line({ attention: items(1) })).toEqual({ alert: null, text: "1 needs attention" });
    expect(line({ attention: items(3), nextDeadlineDays: 2 })).toEqual({ alert: null, text: "3 need attention" });
    expect(line({ nextDeadlineDays: 6 })).toEqual({ alert: null, text: "Next deadline in 6 days" });
    expect(line({ nextDeadlineDays: 0 }).text).toBe("Next deadline today");
    expect(line({ nextDeadlineDays: 1 }).text).toBe("Next deadline tomorrow");
    expect(line({})).toEqual({ alert: null, text: "Nothing needs attention" });
  });
  it("an empty track says how to start", () =>
    expect(line({ total: 0 })).toEqual({ alert: null, text: "Add the first application to start this track" }));
});

describe("sortTracks and parseTrackSort", () => {
  const t = (name: string, updatedMs: number | null, activeCount: number) => ({ name, updatedMs, activeCount });
  const list = [
    t("Job", 100, 1),
    t("phd", 300, 1),
    t("Fellowships", null, 0),
    t("Awards", 200, 5),
    t("Empty2", null, 0),
  ];
  const names = (sort: Parameters<typeof sortTracks>[1]) => sortTracks(list, sort).map((x) => x.name);
  it("recent: last updated first, tracks with no applications last in their own order", () =>
    expect(names("recent")).toEqual(["phd", "Awards", "Job", "Fellowships", "Empty2"]));
  it("name: A to Z ignoring case", () =>
    expect(names("name")).toEqual(["Awards", "Empty2", "Fellowships", "Job", "phd"]));
  it("active: most recently active applications first, ties by last updated, then position", () =>
    expect(names("active")).toEqual(["Awards", "phd", "Job", "Fellowships", "Empty2"]));
  it("returns a new array and leaves the input alone", () => {
    const before = list.map((x) => x.name);
    expect(sortTracks(list, "name")).not.toBe(list);
    expect(list.map((x) => x.name)).toEqual(before);
  });
  it("the sort parameter: anything unknown, empty or repeated is Recent", () => {
    expect(["name", "active", "recent"].map(parseTrackSort)).toEqual(["name", "active", "recent"]);
    for (const v of [undefined, "", "NAME", "x", ["name", "active"], 3, null, "constructor"])
      expect(parseTrackSort(v)).toBe("recent");
  });
});

describe("overviewSummary", () => {
  it("tracks, applications and how many need attention, with singulars", () => {
    expect(
      overviewSummary([
        { total: 7, attention: [1, 2, 3] as never },
        { total: 4, attention: [1] as never },
      ]),
    ).toBe("2 tracks · 11 applications · 4 need attention");
    expect(overviewSummary([{ total: 1, attention: [1] as never }])).toBe(
      "1 track · 1 application · 1 needs attention",
    );
    expect(overviewSummary([])).toBe("0 tracks · 0 applications · 0 need attention");
  });
});
