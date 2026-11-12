import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveStillToDo } from "@/app/actions/settings";
import { getPlannerRanking, getStillToDoChoices, setOptionBuffer, setPlannerSlots, setStillToDo } from "@/lib/db/planner";
import { applications, cellValues, columnOptions, columns, tracks, type ColumnType } from "@/lib/db/schema";
import { setSubmittedStatuses } from "@/lib/db/track-settings";
import { defaultStillToDo, resolveStillToDo } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

describe("defaultStillToDo / resolveStillToDo", () => {
  const opts = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  it("default = the options before the first submitted one", () => {
    expect(defaultStillToDo(opts, [3])).toEqual([1, 2]);
    expect(defaultStillToDo(opts, [4, 2])).toEqual([1]);
    expect(defaultStillToDo(opts, [1])).toEqual([]);
  });
  it("no submitted status = every option", () => {
    expect(defaultStillToDo(opts, [])).toEqual([1, 2, 3, 4]);
    expect(defaultStillToDo(opts, [99])).toEqual([1, 2, 3, 4]);
  });
  it("never saved or unreadable = the default", () => {
    for (const stored of [undefined, null, "x", { a: 1 }, 5]) expect(resolveStillToDo(stored, opts, [3])).toEqual([1, 2]);
  });
  it("a saved list drops deleted ids silently, keeps option order, and may be empty", () => {
    expect(resolveStillToDo([4, 99, 1], opts, [3])).toEqual([1, 4]);
    expect(resolveStillToDo([], opts, [3])).toEqual([]);
    expect(resolveStillToDo([99], opts, [3])).toEqual([]);
  });
});

describe("still-to-do data layer and ranking", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
  afterEach(dropTestDb);

  const TODAY = "2026-11-12";
  const track = (name: string, position = 0) => db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
  const col = (trackId: number, name: string, type: ColumnType, position = 0, isStatus = false) =>
    db.insert(columns).values({ userId: "local", trackId, name, type, position, isStatus }).returning().get().id;
  const opt = (columnId: number, label: string, position: number, bufferDays?: number) =>
    db.insert(columnOptions).values({ userId: "local", columnId, label, color: "blue", position, bufferDays }).returning().get().id;
  const app = (trackId: number, title: string, archived = false) => db.insert(applications).values({ userId: "local", trackId, title, archived }).returning().get().id;
  const cell = (applicationId: number, columnId: number, v: { option?: number; date?: string }) =>
    db.insert(cellValues).values({ userId: "local", applicationId, columnId, valueOptionId: v.option, valueDate: v.date }).run();
  const ids = async (today = TODAY) => (await getPlannerRanking(today)).ranked.map((r) => r.title);

  // A Job-like track: Status (To apply, Applied), Priority (High +3, Low 0), Deadline.
  function job(name = "Job", position = 0) {
    const t = track(name, position);
    const status = col(t, "Status", "single_select", 0, true), pr = col(t, "Priority", "single_select", 1), dl = col(t, "Deadline", "date", 2);
    const toApply = opt(status, "To apply", 0), applied = opt(status, "Applied", 1);
    const high = opt(pr, "High", 0, 3), low = opt(pr, "Low", 1, 0);
    const add = (title: string, s: number | null, deadline: string | null, p: number | null = null, archived = false) => {
      const a = app(t, title, archived);
      if (s !== null) cell(a, status, { option: s });
      if (deadline) cell(a, dl, { date: deadline });
      if (p !== null) cell(a, pr, { option: p });
      return a;
    };
    return { t, status, toApply, applied, high, low, add };
  }

  it("default: only the statuses before Applied are ranked; no status is never ranked", async () => {
    const j = job();
    j.add("todo", j.toApply, "2026-11-20");
    j.add("sent", j.applied, "2026-11-13");
    j.add("nostatus", null, "2026-11-13");
    expect(await ids()).toEqual(["todo"]);
    expect((await getStillToDoChoices(j.t)).map((c) => [c.label, c.stillToDo])).toEqual([["To apply", true], ["Applied", false]]);
  });

  it("changing the setting changes who is ranked; empty list ranks nothing", async () => {
    const j = job();
    j.add("todo", j.toApply, "2026-11-20");
    j.add("sent", j.applied, "2026-11-13");
    expect(await setStillToDo(j.t, [j.toApply, j.applied])).toEqual({ ok: true });
    expect(await ids()).toEqual(["sent", "todo"]);
    expect(await setStillToDo(j.t, [j.applied])).toEqual({ ok: true });
    expect(await ids()).toEqual(["sent"]);
    expect(await setStillToDo(j.t, [])).toEqual({ ok: true });
    expect(await ids()).toEqual([]);
    expect((await getStillToDoChoices(j.t)).every((c) => !c.stillToDo)).toBe(true);
  });

  it("archived applications are left out; applications without a deadline are listed apart", async () => {
    const j = job();
    j.add("live", j.toApply, "2026-11-20");
    j.add("gone", j.toApply, "2026-11-14", null, true);
    j.add("undated", j.toApply, null);
    const r = await getPlannerRanking(TODAY);
    expect(r.ranked.map((x) => x.title)).toEqual(["live"]);
    expect(r.undated.map((x) => x.title)).toEqual(["undated"]);
  });

  it("items carry id, title, track and the score parts", async () => {
    const j = job("Job");
    const a = j.add("one", j.toApply, "2026-11-20", j.high);
    const [item] = (await getPlannerRanking(TODAY)).ranked;
    expect(item).toMatchObject({ id: a, title: "one", trackId: j.t, trackName: "Job", score: 5, daysLeft: 8, priority: { optionId: j.high, buffer: 3, fallback: false } });
  });

  it("validates ids: other tracks' options, junk and unknown tracks are refused and nothing changes", async () => {
    const j = job("Job"), k = job("PhD", 1);
    for (const bad of [[k.toApply], [999], "x", [1.5], null, [j.toApply, "2"]]) expect(await setStillToDo(j.t, bad)).toMatchObject({ ok: false });
    expect(await setStillToDo(999, [])).toMatchObject({ ok: false });
    expect((await getStillToDoChoices(j.t)).map((c) => c.stillToDo)).toEqual([true, false]);
  });

  it("the setting follows a deleted option silently", async () => {
    const j = job();
    await setStillToDo(j.t, [j.toApply, j.applied]);
    db.delete(columnOptions).where(eq(columnOptions.id, j.applied)).run();
    expect((await getStillToDoChoices(j.t)).map((c) => c.id)).toEqual([j.toApply]);
    expect((await getStillToDoChoices(j.t))[0].stillToDo).toBe(true);
  });

  it("with no submitted status every option is still to do; changing the submitted set moves the default", async () => {
    const j = job();
    await setSubmittedStatuses(j.t, []);
    expect((await getStillToDoChoices(j.t)).map((c) => c.stillToDo)).toEqual([true, true]);
    await setSubmittedStatuses(j.t, [j.toApply]);
    expect((await getStillToDoChoices(j.t)).map((c) => c.stillToDo)).toEqual([false, false]);
  });

  it("two tracks with different Priority columns each use their own fallback, then merge into one list", async () => {
    // Job: lowest priority buffer is 0 (Low). PhD: its only options are +5 and +2, so its lowest is 2.
    const j = job("Job", 0);
    const p = track("PhD", 1);
    const pStatus = col(p, "Status", "single_select", 0, true), pPr = col(p, "Importance", "single_select", 1), pDl = col(p, "Deadline", "date", 2);
    const pTodo = opt(pStatus, "To apply", 0);
    const big = opt(pPr, "Big", 0, 5), small = opt(pPr, "Small", 1, 2);
    await setPlannerSlots(p, { priority: pPr, deadline: pDl, effort: null, followUp: null });
    const pa = app(p, "phd-nopriority"); cell(pa, pStatus, { option: pTodo }); cell(pa, pDl, { date: "2026-11-22" }); // 10 - 2 = 8
    const pb = app(p, "phd-big"); cell(pb, pStatus, { option: pTodo }); cell(pb, pDl, { date: "2026-11-22" }); cell(pb, pPr, { option: big }); // 10 - 5 = 5
    j.add("job-nopriority", j.toApply, "2026-11-22"); // 10 - 0 = 10
    j.add("job-high", j.toApply, "2026-11-22", j.high); // 10 - 3 = 7
    const r = (await getPlannerRanking(TODAY)).ranked;
    expect(r.map((x) => [x.title, x.score])).toEqual([["phd-big", 5], ["job-high", 7], ["phd-nopriority", 8], ["job-nopriority", 10]]);
    expect(r.find((x) => x.title === "phd-nopriority")!.priority).toMatchObject({ optionId: small, buffer: 2, fallback: true });
    expect(r.find((x) => x.title === "job-nopriority")!.priority).toMatchObject({ optionId: j.low, buffer: 0, fallback: true });
    expect(r.map((x) => x.trackName)).toEqual(["PhD", "Job", "PhD", "Job"]);
  });

  it("AT-11 through the DB: raising a buffer flips the order", async () => {
    const j = job();
    j.add("A", j.toApply, "2026-11-22", j.low); // 10 days
    j.add("B", j.toApply, "2026-11-20", j.high); // 8 days; Job's High buffer is 3 -> 5
    expect(await ids()).toEqual(["B", "A"]);
    expect(await setOptionBuffer(j.low, 6)).toEqual({ ok: true }); // A: 10 - 6 = 4 < 5
    expect(await ids()).toEqual(["A", "B"]);
  });

  it("the action saves, refreshes only on success and refuses a non-integer track", async () => {
    const j = job();
    expect(await saveStillToDo(j.t, [j.applied])).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveStillToDo(j.t, [999])).toMatchObject({ ok: false });
    expect(await saveStillToDo("1" as unknown as number, [])).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await getStillToDoChoices(j.t)).map((c) => c.stillToDo)).toEqual([false, true]);
  });
});
