import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { savePlannerSlots } from "@/app/actions/settings";
import { getPlannerSlots, plannerSlotsKey, setPlannerSlots } from "@/lib/db/planner";
import { columns, tracks, type ColumnType } from "@/lib/db/schema";
import { setSetting } from "@/lib/db/settings";
import { checkSlots, resolveSlots, type SlotColumn } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
afterEach(dropTestDb);

const c = (id: number, name: string, type: ColumnType, hidden = false): SlotColumn => ({ id, name, type, hidden });
const EMPTY = { priority: null, deadline: null, effort: null, followUp: null };

describe("pure slot rules", () => {
  const cols = [c(1, " PRIORITY ", "single_select"), c(2, "Deadline", "date"), c(3, "Effort", "single_select"), c(4, "Follow-up date", "date"), c(5, "Other date", "date")];
  it("defaults by name and type, skipping hidden columns and wrong types", () => {
    expect(resolveSlots(undefined, cols)).toEqual({ priority: 1, deadline: 2, effort: 3, followUp: 4 });
    expect(resolveSlots("junk", cols)).toEqual({ priority: 1, deadline: 2, effort: 3, followUp: 4 });
    expect(resolveSlots(undefined, [c(1, "Priority", "text"), c(2, "Deadline", "date", true), c(3, "Effort", "date")])).toEqual(EMPTY);
  });
  it("a saved mapping wins over defaults; null stays empty; wrong type or unknown id resolves to empty", () => {
    expect(resolveSlots({ priority: 3, deadline: null, effort: 1, followUp: 5 }, cols)).toEqual({ priority: 3, deadline: null, effort: 1, followUp: 5 });
    expect(resolveSlots({ priority: 2, deadline: 99, effort: "3", followUp: 1 }, cols)).toEqual(EMPTY);
    expect(resolveSlots({}, cols)).toEqual(EMPTY);
  });
  it("Priority and Effort on the same column: refused when saving, Effort dropped when resolving", () => {
    expect(checkSlots({ ...EMPTY, priority: 1, effort: 1 }, cols)).toMatchObject({ error: expect.stringContaining("different columns") });
    expect(resolveSlots({ ...EMPTY, priority: 1, effort: 1, deadline: 2 }, cols)).toEqual({ ...EMPTY, priority: 1, deadline: 2 });
    expect(checkSlots({ ...EMPTY, deadline: 2, followUp: 2 }, cols)).toHaveProperty("slots"); // only Priority/Effort matter
  });
  it("checkSlots accepts valid, refuses missing keys, non-integers, foreign ids and wrong types", () => {
    expect(checkSlots({ ...EMPTY, priority: 3, deadline: 5 }, cols)).toEqual({ slots: { ...EMPTY, priority: 3, deadline: 5 } });
    for (const bad of [null, [], "x", { ...EMPTY, effort: undefined }, { ...EMPTY, effort: "3" }, { ...EMPTY, effort: 1.5 }, { ...EMPTY, effort: 99 }, { ...EMPTY, effort: 2 }, { ...EMPTY, followUp: 1 }]) {
      expect(checkSlots(bad, cols)).toHaveProperty("error");
    }
  });
});

describe("planner slots data layer", () => {
  const track = (name: string, position = 0) => db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
  const col = (trackId: number, name: string, type: ColumnType, position = 0, hidden = false) =>
    db.insert(columns).values({ userId: "local", trackId, name, type, position, hidden }).returning().get().id;

  it("resolves the defaults when never saved, and lists the choices per slot with hidden columns included", async () => {
    const t = track("Job");
    const p = col(t, "Priority", "single_select", 0), d = col(t, "Deadline", "date", 1), e = col(t, "Notes", "single_select", 2, true);
    const r = await getPlannerSlots(t);
    expect(r.slots).toEqual({ priority: p, deadline: d, effort: null, followUp: null });
    expect(r.choices.priority.map((x) => x.id)).toEqual([p, e]);
    expect(r.choices.followUp.map((x) => x.id)).toEqual([d]);
    expect(r.choices.effort[1]).toMatchObject({ id: e, hidden: true });
  });

  it("saves and reads back; an explicit None beats the default", async () => {
    const t = track("Job");
    const d = col(t, "Deadline", "date", 1), f = col(t, "Chase", "date", 2);
    expect(await setPlannerSlots(t, { priority: null, deadline: f, effort: null, followUp: d })).toEqual({ ok: true });
    expect((await getPlannerSlots(t)).slots).toEqual({ priority: null, deadline: f, effort: null, followUp: d });
  });

  it("refuses a wrong type or another track's column and saves nothing", async () => {
    const t = track("Job"), o = track("PhD", 1);
    const d = col(t, "Deadline", "date", 0), other = col(o, "Priority", "single_select", 0), txt = col(t, "Company", "text", 1);
    expect(await setPlannerSlots(t, { ...EMPTY, priority: d })).toMatchObject({ ok: false, error: expect.stringContaining("single-select") });
    expect(await setPlannerSlots(t, { ...EMPTY, priority: txt })).toMatchObject({ ok: false });
    expect(await setPlannerSlots(t, { ...EMPTY, priority: other })).toMatchObject({ ok: false, error: expect.stringContaining("not in this track") });
    expect(await setPlannerSlots(999, EMPTY)).toEqual({ ok: false, error: "Track not found." });
    expect(await savePlannerSlots(t, { ...EMPTY, deadline: other })).toMatchObject({ ok: false });
    expect(refresh).not.toHaveBeenCalled();
    expect((await getPlannerSlots(t)).slots).toEqual({ ...EMPTY, deadline: d }); // still the defaults
  });

  it("a saved column that was deleted, changed type or sits in another track resolves to empty", async () => {
    const t = track("Job"), o = track("PhD", 1);
    const d = col(t, "Deadline", "date", 0), x = col(o, "Deadline", "date", 0), p = col(t, "Priority", "single_select", 1);
    await setSetting(plannerSlotsKey(t), { priority: p, deadline: x, effort: null, followUp: d });
    expect((await getPlannerSlots(t)).slots).toEqual({ ...EMPTY, priority: p, followUp: d });
    db.update(columns).set({ type: "text" }).where(eq(columns.id, p)).run();
    expect((await getPlannerSlots(t)).slots).toEqual({ ...EMPTY, followUp: d });
    db.delete(columns).where(eq(columns.id, d)).run();
    expect((await getPlannerSlots(t)).slots).toEqual(EMPTY);
  });

  it("refuses Priority and Effort on the same column and saves nothing", async () => {
    const t = track("Job");
    const p = col(t, "Priority", "single_select", 0), e = col(t, "Effort", "single_select", 1);
    expect(await setPlannerSlots(t, { ...EMPTY, priority: p, effort: p })).toMatchObject({ ok: false, error: expect.stringContaining("different columns") });
    expect((await getPlannerSlots(t)).slots).toEqual({ ...EMPTY, priority: p, effort: e }); // still the defaults
    await setSetting(plannerSlotsKey(t), { ...EMPTY, priority: p, effort: p }); // a hand-edited setting
    expect((await getPlannerSlots(t)).slots).toEqual({ ...EMPTY, priority: p });
  });

  it("the action refreshes after a save", async () => {
    const t = track("Job");
    expect(await savePlannerSlots(t, EMPTY)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await savePlannerSlots(1.5, EMPTY)).toEqual({ ok: false, error: "Track not found." });
  });
});
