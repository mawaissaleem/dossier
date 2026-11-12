import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overdueAlerts, overdueText } from "@/lib/dashboard";
import { getOverdueAlerts, setPlannerSlots, setRankingRules, setStillToDo } from "@/lib/db/planner";
import { applications, cellValues, columnOptions, columns, tracks, type ColumnType } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

const item = (id: number, deadline: unknown) => ({ id, title: `a${id}`, trackId: 1, trackName: "Job", deadline });
const TODAY = "2026-11-12";

describe("overdueText / overdueAlerts (pure)", () => {
  it("singular and plural", () => {
    expect(overdueText(1)).toBe("Overdue by 1 day");
    expect(overdueText(2)).toBe("Overdue by 2 days");
    expect(overdueText(30)).toBe("Overdue by 30 days");
  });
  it("before today only; today, future, blank and invalid are left out", () => {
    const r = overdueAlerts([item(1, "2026-11-11"), item(2, TODAY), item(3, "2026-11-13"), item(4, ""), item(5, null), item(6, "2026-02-30"), item(7, "x")], TODAY);
    expect(r).toMatchObject([{ id: 1, days: 1, text: "Overdue by 1 day", date: "11 Nov 2026" }]);
  });
  it("most overdue first, ties by lower id; counts across a year boundary", () => {
    expect(overdueAlerts([item(9, "2026-11-10"), item(5, "2026-11-01"), item(3, "2026-11-01"), item(7, "2026-11-11")], TODAY).map((x) => x.id)).toEqual([3, 5, 9, 7]);
    expect(overdueAlerts([item(1, "2026-12-30")], "2027-01-02")[0].days).toBe(3);
  });
  it("refuses an invalid today", () => {
    expect(() => overdueAlerts([], "nope")).toThrow();
  });
});

describe("getOverdueAlerts (data layer)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  const col = (trackId: number, name: string, type: ColumnType, position: number, isStatus = false) =>
    db.insert(columns).values({ userId: "local", trackId, name, type, position, isStatus }).returning().get().id;
  function track(name: string, position: number, deadlineName = "Deadline") {
    const t = db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
    const status = col(t, "Status", "single_select", 0, true);
    const opt = (label: string, p: number) => db.insert(columnOptions).values({ userId: "local", columnId: status, label, color: "blue", position: p }).returning().get().id;
    const [toApply, applied] = [opt("To apply", 0), opt("Applied", 1)];
    const dl = col(t, deadlineName, "date", 1);
    const add = (title: string, s: number, deadline?: string, archived = false) => {
      const a = db.insert(applications).values({ userId: "local", trackId: t, title, archived }).returning().get().id;
      db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: status, valueOptionId: s }).run();
      if (deadline) db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: dl, valueDate: deadline }).run();
      return a;
    };
    return { t, toApply, applied, add };
  }
  const titles = async () => (await getOverdueAlerts(TODAY)).map((d) => d.title);

  it("shown under all three overdue rules", async () => {
    const j = track("Job", 0);
    j.add("late", j.toApply, "2026-11-01");
    for (const rule of ["pin", "hide", "normal"]) {
      expect(await setRankingRules(rule, "ignore")).toEqual({ ok: true });
      expect(await getOverdueAlerts(TODAY)).toMatchObject([{ title: "late", trackName: "Job", days: 11, text: "Overdue by 11 days", date: "1 Nov 2026" }]);
    }
  });

  it("not-still-to-do, archived, due today, future and undated are excluded", async () => {
    const j = track("Job", 0);
    j.add("sent", j.applied, "2026-11-01");
    j.add("gone", j.toApply, "2026-11-01", true);
    j.add("today", j.toApply, TODAY);
    j.add("future", j.toApply, "2026-11-20");
    j.add("none", j.toApply);
    j.add("late", j.toApply, "2026-11-11");
    expect(await titles()).toEqual(["late"]);
    await setStillToDo(j.t, [j.applied]);
    expect(await titles()).toEqual(["sent"]);
  });

  it("each track's own Deadline slot; most overdue first across tracks, ties by id", async () => {
    const a = track("Job", 0), b = track("PhD", 1, "Closing date");
    a.add("job-5d", a.toApply, "2026-11-07");
    b.add("phd-unmapped", b.toApply, "2026-10-01"); // "Closing date" is not a default Deadline slot
    a.add("job-9d", a.toApply, "2026-11-03");
    b.add("phd-5d", b.toApply, "2026-11-07");
    expect(await titles()).toEqual(["job-9d", "job-5d"]);
    const closing = db.select().from(columns).all().find((x) => x.trackId === b.t && x.name === "Closing date")!.id;
    await setPlannerSlots(b.t, { priority: null, deadline: closing, effort: null, followUp: null });
    expect(await titles()).toEqual(["phd-unmapped", "job-9d", "job-5d", "phd-5d"]);
  });
});
