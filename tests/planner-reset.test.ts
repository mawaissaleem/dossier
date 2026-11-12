import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { resetPlanner } from "@/app/actions/settings";
import { getCapacity, getPlannerBuffers, getPlannerSlots, getRankingRules, getStillToDoChoices, resetPlannerSettings, setCapacity, setOptionBuffer, setPlannerSlots, setRankingRules, setStillToDo } from "@/lib/db/planner";
import { setSetting } from "@/lib/db/settings";
import { setExpectedLabels, setSubmittedStatuses } from "@/lib/db/track-settings";
import { applications, cellValues, columnOptions, columns, settings, tracks } from "@/lib/db/schema";
import { defaultBuffer } from "@/lib/planner";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
afterEach(dropTestDb);

// Everything a reset may or may not touch, in a comparable shape (timestamps left out: a reset rewrites updated_at).
const state = () => ({
  settings: db.select({ key: settings.key, value: settings.value }).from(settings).all().sort((a, b) => a.key.localeCompare(b.key)),
  options: db.select({ id: columnOptions.id, columnId: columnOptions.columnId, label: columnOptions.label, color: columnOptions.color, position: columnOptions.position, bufferDays: columnOptions.bufferDays }).from(columnOptions).all(),
  columns: db.select({ id: columns.id, name: columns.name, hidden: columns.hidden }).from(columns).all(),
});
const resolved = async () => {
  const ids = db.select({ id: tracks.id }).from(tracks).all().map((t) => t.id);
  return {
    slots: await Promise.all(ids.map((id) => getPlannerSlots(id).then((r) => r.slots))),
    buffers: await Promise.all(ids.map((id) => getPlannerBuffers(id))),
    stillToDo: await Promise.all(ids.map((id) => getStillToDoChoices(id))),
    rules: await getRankingRules(),
    capacity: await getCapacity(),
  };
};

describe("defaultBuffer", () => {
  it("seed labels get the seed value (case and spaces ignored), every other label NULL", () => {
    expect([" PRIORITY ", "good-to-have"].map((l) => defaultBuffer("priority", l))).toEqual([3, 0]);
    expect(["Heavy", "medium", "Light"].map((l) => defaultBuffer("effort", l))).toEqual([2, 1, 0]);
    expect(defaultBuffer("effort", "Priority")).toBeNull(); // same slot only
    expect(defaultBuffer("priority", "Heavy")).toBeNull();
    expect(defaultBuffer("priority", "toString")).toBeNull(); // not an inherited property
    expect(["Constructor", "constructor", "__proto__", " hasOwnProperty "].map((l) => defaultBuffer("priority", l))).toEqual([null, null, null, null]);
    expect(["Constructor", "__proto__"].map((l) => defaultBuffer("effort", l))).toEqual([null, null]);
    expect(defaultBuffer("priority", "Urgent")).toBeNull();
  });
});

describe("resetPlannerSettings", () => {
  it("after changing every rule, a reset equals a freshly seeded database", async () => {
    runSeed();
    const fresh = { state: state(), resolved: await resolved() };
    const [job, phd] = db.select({ id: tracks.id }).from(tracks).orderBy(tracks.id).all().map((t) => t.id);

    // Change every planner rule.
    const j = await getPlannerBuffers(job);
    expect((await setOptionBuffer(j.priority!.options[0].id, 40)).ok).toBe(true);
    expect((await setOptionBuffer(j.effort!.options[1].id, null)).ok).toBe(true);
    expect((await setPlannerSlots(job, { priority: null, deadline: null, effort: null, followUp: null })).ok).toBe(true);
    expect((await setStillToDo(job, [])).ok).toBe(true);
    expect((await setStillToDo(phd, [(await getStillToDoChoices(phd))[3].id])).ok).toBe(true);
    expect((await setRankingRules("hide", "ignore")).ok).toBe(true);
    expect((await setCapacity(9)).ok).toBe(true);
    expect(await resolved()).not.toEqual(fresh.resolved);

    await resetPlannerSettings();
    expect(await resolved()).toEqual(fresh.resolved);
    expect(state()).toEqual(fresh.state); // including the settings rows: no planner keys left, nothing else added
  });

  it("leaves unrelated settings, files, cells and applications alone", async () => {
    runSeed();
    const [job] = db.select({ id: tracks.id }).from(tracks).orderBy(tracks.id).all().map((t) => t.id);
    await setSubmittedStatuses(job, [(await getStillToDoChoices(job))[2].id]);
    await setExpectedLabels(job, ["Portfolio"]);
    await setSetting("files_root", "/somewhere/files");
    await setSetting("backup_destination", "/somewhere/backups");
    await setSetting("planner.capacity", 12);
    const app = db.insert(applications).values({ userId: "local", trackId: job, title: "A" }).returning().get();
    const col = db.select().from(columns).where(eq(columns.trackId, job)).all()[0];
    db.insert(cellValues).values({ userId: "local", applicationId: app.id, columnId: col.id, valueText: "x" }).run();
    const before = { ...state(), apps: db.select().from(applications).all(), cells: db.select().from(cellValues).all() };

    await resetPlannerSettings();
    const after = { ...state(), apps: db.select().from(applications).all(), cells: db.select().from(cellValues).all() };
    expect(after.settings).toEqual(before.settings.filter((s) => s.key !== "planner.capacity"));
    expect(after.options).toEqual(before.options); // buffers were already the seed's
    expect(after.columns).toEqual(before.columns);
    expect(after.apps).toEqual(before.apps);
    expect(after.cells).toEqual(before.cells);
  });

  it("a renamed or extra option of a slot column gets NULL; other columns' buffers are kept", async () => {
    runSeed();
    const [job] = db.select({ id: tracks.id }).from(tracks).orderBy(tracks.id).all().map((t) => t.id);
    const { priority, effort } = await getPlannerBuffers(job);
    const pCol = db.select().from(columnOptions).where(eq(columnOptions.id, priority!.options[0].id)).get()!.columnId;
    db.update(columnOptions).set({ label: "Urgent", bufferDays: 9 }).where(eq(columnOptions.id, priority!.options[0].id)).run();
    const extra = db.insert(columnOptions).values({ userId: "local", columnId: pCol, label: "Extra", color: "gray", position: 9, bufferDays: 5 }).returning().get();
    const other = db.insert(columns).values({ userId: "local", trackId: job, name: "Tier", type: "single_select", position: 99 }).returning().get();
    const foreign = db.insert(columnOptions).values({ userId: "local", columnId: other.id, label: "Heavy", color: "gray", position: 0, bufferDays: 7 }).returning().get();

    await resetPlannerSettings();
    const days = (id: number) => db.select().from(columnOptions).where(eq(columnOptions.id, id)).get()!.bufferDays;
    expect(days(priority!.options[0].id)).toBeNull();
    expect(days(extra.id)).toBeNull();
    expect(days(priority!.options[1].id)).toBe(0); // Good-to-have
    expect(effort!.options.map((o) => days(o.id))).toEqual([2, 1, 0]);
    expect(days(foreign.id)).toBe(7); // not a slot column
    expect(db.select().from(columnOptions).where(eq(columnOptions.id, priority!.options[0].id)).get()!.label).toBe("Urgent"); // labels untouched
  });

  it("options labelled like Object.prototype members get NULL and the reset still succeeds", async () => {
    runSeed();
    const [job] = db.select({ id: tracks.id }).from(tracks).orderBy(tracks.id).all().map((t) => t.id);
    const { priority, effort } = await getPlannerBuffers(job);
    db.update(columnOptions).set({ label: "Constructor", bufferDays: 4 }).where(eq(columnOptions.id, priority!.options[1].id)).run();
    db.update(columnOptions).set({ label: "__proto__", bufferDays: 4 }).where(eq(columnOptions.id, effort!.options[0].id)).run();
    await setCapacity(9);

    await expect(resetPlannerSettings()).resolves.toBeUndefined();
    const days = (id: number) => db.select().from(columnOptions).where(eq(columnOptions.id, id)).get()!.bufferDays;
    expect(days(priority!.options[1].id)).toBeNull();
    expect(days(effort!.options[0].id)).toBeNull();
    expect(await getCapacity()).toBe(4);
  });

  it("buffers follow the slot columns the defaults pick, not the saved mapping", async () => {
    runSeed();
    const [job] = db.select({ id: tracks.id }).from(tracks).orderBy(tracks.id).all().map((t) => t.id);
    const { priority } = await getPlannerBuffers(job);
    const tier = db.insert(columns).values({ userId: "local", trackId: job, name: "Tier", type: "single_select", position: 99 }).returning().get();
    const t1 = db.insert(columnOptions).values({ userId: "local", columnId: tier.id, label: "Heavy", color: "gray", position: 0, bufferDays: 7 }).returning().get();
    expect((await setPlannerSlots(job, { priority: tier.id, deadline: null, effort: null, followUp: null })).ok).toBe(true);

    await resetPlannerSettings();
    expect(db.select().from(columnOptions).where(eq(columnOptions.id, t1.id)).get()!.bufferDays).toBe(7); // Tier is no longer a slot
    expect((await getPlannerBuffers(job)).priority!.options.map((o) => o.bufferDays)).toEqual(priority!.options.map((o) => defaultBuffer("priority", o.label)));
  });

  it("a failure part-way rolls everything back", async () => {
    runSeed();
    const [job] = db.select({ id: tracks.id }).from(tracks).orderBy(tracks.id).all().map((t) => t.id);
    await setCapacity(9);
    await setStillToDo(job, []);
    await setOptionBuffer((await getPlannerBuffers(job)).priority!.options[0].id, 40);
    const before = state();
    db.$client.exec("CREATE TRIGGER fail_buffer BEFORE UPDATE ON column_options BEGIN SELECT RAISE(ABORT, 'boom'); END");

    await expect(resetPlannerSettings()).rejects.toThrow();
    expect(state()).toEqual(before); // the key deletes that ran before the failing update are rolled back
    expect(await getCapacity()).toBe(9);

    vi.mocked(refresh).mockClear();
    expect(await resetPlanner(true)).toEqual({ ok: false, error: "Could not reset. Nothing was changed." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the action refreshes on success", async () => {
    runSeed();
    expect(await resetPlanner(true)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("the action refuses without a literal true confirm and changes nothing (NFR-4)", async () => {
    runSeed();
    await setCapacity(9);
    vi.mocked(refresh).mockClear();
    for (const bad of [false, undefined, "true", 1, null]) {
      expect(await resetPlanner(bad as never), String(bad)).toMatchObject({ ok: false, error: expect.stringContaining("must be confirmed") });
    }
    expect(await getCapacity()).toBe(9);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("works with no tracks and with another user's rows untouched", async () => {
    await expect(resetPlannerSettings()).resolves.toBeUndefined();
    db.insert(settings).values({ userId: "someone-else", key: "planner.capacity", value: "9" }).run();
    await resetPlannerSettings();
    expect(db.select().from(settings).where(eq(settings.userId, "someone-else")).all()).toHaveLength(1);
  });
});
