import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upcomingDeadlines } from "@/lib/dashboard";
import { getUpcomingDeadlines, setPlannerSlots, setRankingRules, setStillToDo } from "@/lib/db/planner";
import { applications, cellValues, columnOptions, columns, tracks, type ColumnType } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

const item = (id: number, deadline: unknown) => ({ id, title: `a${id}`, trackId: 1, trackName: "Job", deadline });

describe("upcomingDeadlines (pure)", () => {
  const TODAY = "2026-11-12";
  it("today, tomorrow and N days: big number, unit and one phrase", () => {
    const r = upcomingDeadlines([item(1, "2026-11-12"), item(2, "2026-11-13"), item(3, "2026-11-15"), item(4, "2027-01-01")], TODAY, 10);
    expect(r.map((x) => [x.big, x.unit, x.text, x.days])).toEqual([["Today", null, "Today", 0], ["Tomorrow", null, "Tomorrow", 1], ["3", "days", "3 days", 3], ["50", "days", "50 days", 50]]);
    expect(r[0].date).toBe("12 Nov 2026");
  });
  it("overdue, blank and invalid deadlines are left out", () => {
    expect(upcomingDeadlines([item(1, "2026-11-11"), item(2, ""), item(3, null), item(4, "2026-02-30"), item(5, "soon"), item(6, 5)], TODAY, 10)).toEqual([]);
  });
  it("nearest first, ties by lower id, cut to the limit", () => {
    const r = upcomingDeadlines([item(9, "2026-11-20"), item(5, "2026-11-14"), item(3, "2026-11-14"), item(7, "2026-11-13")], TODAY, 3);
    expect(r.map((x) => x.id)).toEqual([7, 3, 5]);
    expect(upcomingDeadlines([item(1, "2026-11-13")], TODAY, 0)).toEqual([]);
  });
  it("month and year boundaries count calendar days", () => {
    expect(upcomingDeadlines([item(1, "2027-01-02")], "2026-12-30", 1)[0]).toMatchObject({ days: 3, text: "3 days", date: "2 Jan 2027" });
    expect(upcomingDeadlines([item(1, "2026-03-01")], "2026-02-28", 1)[0].days).toBe(1);
  });
  it("refuses an invalid today", () => {
    expect(() => upcomingDeadlines([], "nope", 1)).toThrow();
  });
});

describe("getUpcomingDeadlines (data layer)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);
  const TODAY = "2026-11-12";

  const col = (trackId: number, name: string, type: ColumnType, position: number, isStatus = false) =>
    db.insert(columns).values({ userId: "local", trackId, name, type, position, isStatus }).returning().get().id;
  // Track with Status (To apply, Applied) and, unless `deadlineName` is null, a Deadline-named date column.
  function track(name: string, position: number, deadlineName: string | null = "Deadline") {
    const t = db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
    const status = col(t, "Status", "single_select", 0, true);
    const opt = (label: string, p: number) => db.insert(columnOptions).values({ userId: "local", columnId: status, label, color: "blue", position: p }).returning().get().id;
    const [toApply, applied] = [opt("To apply", 0), opt("Applied", 1)];
    const dl = deadlineName ? col(t, deadlineName, "date", 1) : null;
    const add = (title: string, s: number, deadline?: string, archived = false) => {
      const a = db.insert(applications).values({ userId: "local", trackId: t, title, archived }).returning().get().id;
      db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: status, valueOptionId: s }).run();
      if (dl && deadline) db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: dl, valueDate: deadline }).run();
      return a;
    };
    return { t, toApply, applied, add };
  }
  const titles = async (limit = 10) => (await getUpcomingDeadlines(TODAY, limit)).map((d) => d.title);

  it("only still-to-do applications; archived, overdue and undated are left out", async () => {
    const j = track("Job", 0);
    j.add("ok", j.toApply, "2026-11-20");
    j.add("sent", j.applied, "2026-11-13");
    j.add("gone", j.toApply, "2026-11-13", true);
    j.add("late", j.toApply, "2026-11-01");
    j.add("none", j.toApply);
    const r = await getUpcomingDeadlines(TODAY, 10);
    expect(r).toMatchObject([{ title: "ok", trackName: "Job", text: "8 days", date: "20 Nov 2026" }]);
  });

  it("changing the still-to-do setting changes who counts", async () => {
    const j = track("Job", 0);
    j.add("sent", j.applied, "2026-11-13");
    expect(await titles()).toEqual([]);
    await setStillToDo(j.t, [j.applied]);
    expect(await titles()).toEqual(["sent"]);
  });

  it("each track's own Deadline slot is used; a track with no Deadline slot contributes nothing", async () => {
    const a = track("Job", 0), b = track("PhD", 1, "Closing date"), c = track("Misc", 2, null);
    a.add("job", a.toApply, "2026-11-15");
    b.add("phd-unmapped", b.toApply, "2026-11-13"); // "Closing date" is not a default Deadline slot name
    c.add("misc", c.toApply);
    expect(await titles()).toEqual(["job"]);
    const closing = db.select().from(columns).all().find((x) => x.trackId === b.t && x.name === "Closing date")!.id;
    expect(await setPlannerSlots(b.t, { priority: null, deadline: closing, effort: null, followUp: null })).toEqual({ ok: true });
    expect(await titles()).toEqual(["phd-unmapped", "job"]);
  });

  it("the overdue 'hide' rule does not change it; the limit and tie order hold across tracks", async () => {
    const a = track("Job", 0), b = track("PhD", 1);
    b.add("b-first", b.toApply, "2026-11-14");
    a.add("a-late", a.toApply, "2026-11-01");
    a.add("a-tie", a.toApply, "2026-11-14");
    a.add("a-soon", a.toApply, "2026-11-13");
    await setRankingRules("hide", "ignore");
    expect(await titles()).toEqual(["a-soon", "b-first", "a-tie"]); // b-first has the lower id of the 14 Nov pair
    expect(await titles(2)).toEqual(["a-soon", "b-first"]);
  });
});
