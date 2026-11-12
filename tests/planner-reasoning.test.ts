import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateApplication } from "@/lib/db/applications";
import { setCellValue } from "@/lib/db/cells";
import { getPlannerRanking, setRankingRules } from "@/lib/db/planner";
import { localToday } from "@/lib/deadline";
import { applications, cellValues, columnOptions, columns, tracks, type ColumnType } from "@/lib/db/schema";
import { reasoning } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

const p = (label: string | null, buffer: number) => ({ label, buffer });
const dated = (daysLeft: number, pr = p("Priority", 3), ef = p(null, 0)) => reasoning({ priority: pr, effort: ef, daysLeft, daysUntouched: null });

describe("reasoning", () => {
  it("the build-plan example, verbatim", () => {
    expect(dated(5, p("Priority", 3), p("Heavy", 2))).toBe("Priority (+3), Heavy effort (+2), due in 5 days");
  });
  it("effort is left out without an effort value", () => {
    expect(dated(5)).toBe("Priority (+3), due in 5 days");
  });
  it("FR-8.7 fallback names 'No priority'", () => {
    expect(dated(2, p(null, 0))).toBe("No priority (+0), due in 2 days");
  });
  it("due today, tomorrow, singular and plural, overdue", () => {
    expect([0, 1, 2].map((n) => dated(n))).toEqual(["Priority (+3), due today", "Priority (+3), due tomorrow", "Priority (+3), due in 2 days"]);
    expect([-1, -4].map((n) => dated(n))).toEqual(["Priority (+3), overdue by 1 day", "Priority (+3), overdue by 4 days"]);
  });
  it("no deadline: last, and stale with today, 1 day, N days", () => {
    const u = (daysUntouched: number | null) => reasoning({ priority: p("Low", 0), effort: p("Light", 0), daysLeft: null, daysUntouched });
    expect(u(null)).toBe("Low (+0), Light effort (+0), no deadline");
    expect([0, 1, 9].map(u)).toEqual([
      "Low (+0), Light effort (+0), no deadline, untouched today",
      "Low (+0), Light effort (+0), no deadline, untouched for 1 day",
      "Low (+0), Light effort (+0), no deadline, untouched for 9 days",
    ]);
  });
});

describe("reasoning through the database (AT-11)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  const TODAY = "2026-11-12";
  const dayPlus = (n: number) => new Date(Date.UTC(2026, 10, 12 + n)).toISOString().slice(0, 10);

  function setup() {
    const tr = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const col = (name: string, type: ColumnType, position: number, isStatus = false) => db.insert(columns).values({ userId: "local", trackId: tr, name, type, position, isStatus }).returning().get().id;
    const [status, pr, ef, dl, notes] = [col("Status", "single_select", 0, true), col("Priority", "single_select", 1), col("Effort", "single_select", 2), col("Deadline", "date", 3), col("Notes", "text", 4)];
    const opt = (columnId: number, label: string, position: number, bufferDays: number) => db.insert(columnOptions).values({ userId: "local", columnId, label, color: "blue", position, bufferDays }).returning().get().id;
    const todo = opt(status, "To apply", 0, 0);
    const priority = opt(pr, "Priority", 0, 3), good = opt(pr, "Good-to-have", 1, 0), heavy = opt(ef, "Heavy", 0, 2);
    const add = (title: string, deadline: string | null, p: number | null, e: number | null = null, updatedAt = new Date()) => {
      const a = db.insert(applications).values({ userId: "local", trackId: tr, title, updatedAt }).returning().get().id;
      const set = (columnId: number, v: { valueOptionId?: number; valueDate?: string }) => db.insert(cellValues).values({ userId: "local", applicationId: a, columnId, ...v }).run();
      set(status, { valueOptionId: todo });
      if (p !== null) set(pr, { valueOptionId: p });
      if (e !== null) set(ef, { valueOptionId: e });
      if (deadline) set(dl, { valueDate: deadline });
      return a;
    };
    return { add, priority, good, heavy, dl, notes };
  }

  it("AT-11: order and reasoning, then the order flips when the priority one is due in 6 days", async () => {
    const { add, priority, good, dl } = setup();
    const a = add("prio", dayPlus(2), priority);
    add("good", dayPlus(1), good);
    let r = (await getPlannerRanking(TODAY)).ranked;
    expect(r.map((x) => x.title)).toEqual(["prio", "good"]);
    expect(r.map((x) => x.reasoning)).toEqual(["Priority (+3), due in 2 days", "Good-to-have (+0), due tomorrow"]);
    db.update(cellValues).set({ valueDate: dayPlus(6) }).where(eqCell(a, dl)).run();
    r = (await getPlannerRanking(TODAY)).ranked;
    expect(r.map((x) => x.title)).toEqual(["good", "prio"]);
    expect(r[1].reasoning).toBe("Priority (+3), due in 6 days");
  });

  it("no priority, overdue and undated rows", async () => {
    const { add, good } = setup();
    add("late", dayPlus(-3), null);
    add("nodate", null, good, null, new Date(2026, 10, 9, 12)); // local noon, 3 days before TODAY
    const out = await getPlannerRanking(TODAY);
    expect(out.ranked[0]).toMatchObject({ overdue: true, reasoning: "No priority (+0), overdue by 3 days" });
    expect(out.undated[0].reasoning).toBe("Good-to-have (+0), no deadline");
    await setRankingRules("pin", "stale");
    expect((await getPlannerRanking(TODAY)).undated[0].reasoning).toBe("Good-to-have (+0), no deadline, untouched for 3 days");
  });

  // Every edit counts as touched: a table/board cell write and an edit-form save of a plain field both reset days untouched.
  it.each([
    ["a table/board cell write", (id: number, col: number) => setCellValue(id, col, "Berlin")],
    ["an edit-form save of a plain field", (id: number, col: number) => updateApplication({ id, title: "nodate", values: [{ columnId: col, value: "Berlin" }] })],
  ])("%s bumps updated_at, so the application reads as untouched today", async (_, edit) => {
    const { add, notes } = setup();
    const id = add("nodate", null, null, null, new Date(Date.now() - 10 * 86_400_000));
    await setRankingRules("pin", "stale");
    const today = localToday();
    expect((await getPlannerRanking(today)).undated[0].daysUntouched).toBeGreaterThanOrEqual(9);
    expect(await edit(id, notes)).toMatchObject({ ok: true });
    expect((await getPlannerRanking(today)).undated[0]).toMatchObject({ daysUntouched: 0, reasoning: "No priority (+0), no deadline, untouched today" });
  });
});

const eqCell = (applicationId: number, columnId: number) => and(eq(cellValues.applicationId, applicationId), eq(cellValues.columnId, columnId));
