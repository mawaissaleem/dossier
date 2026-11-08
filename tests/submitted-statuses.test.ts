import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveSubmittedStatuses } from "@/app/actions/settings";
import { setStatusColumn } from "@/lib/db/columns";
import { columnOptions, columns, settings, tracks } from "@/lib/db/schema";
import { getSubmittedChoices, getSubmittedStatuses, isSubmittedStatus, setSubmittedStatuses, submittedKey } from "@/lib/db/track-settings";
import { setSetting } from "@/lib/db/settings";
import { checkSubmittedIds, resolveSubmittedStatuses } from "@/lib/submitted-statuses";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
afterEach(dropTestDb);

const track = (name: string, position = 0) => db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
const col = (trackId: number, name: string, isStatus: boolean) =>
  db.insert(columns).values({ userId: "local", trackId, name, type: "single_select", position: isStatus ? 0 : 1, isStatus }).returning().get().id;
const opts = (columnId: number, labels: string[]) =>
  labels.map((label, position) => db.insert(columnOptions).values({ userId: "local", columnId, label, color: "blue", position }).returning().get().id);

describe("pure helpers", () => {
  const o = [{ id: 1, label: "To apply" }, { id: 2, label: " APPLIED " }, { id: 3, label: "Submitted" }];
  it("defaults by label when unset or unreadable, saved list otherwise (empty stays empty)", () => {
    expect(resolveSubmittedStatuses(undefined, o)).toEqual([2, 3]);
    expect(resolveSubmittedStatuses("nope", o)).toEqual([2, 3]);
    expect(resolveSubmittedStatuses([1, 99], o)).toEqual([1]);
    expect(resolveSubmittedStatuses([], o)).toEqual([]);
  });
  it("checkSubmittedIds refuses non-lists, non-integers and foreign ids, dedupes in option order", () => {
    expect(checkSubmittedIds([3, 1, 3], o)).toEqual({ ids: [1, 3] });
    expect(checkSubmittedIds([], o)).toEqual({ ids: [] });
    expect(checkSubmittedIds("1", o)).toHaveProperty("error");
    expect(checkSubmittedIds([1.5], o)).toHaveProperty("error");
    expect(checkSubmittedIds([1, 99], o)).toHaveProperty("error");
  });
});

describe("track submitted statuses", () => {
  it("defaults to Applied / Submitted labels on any track when never saved", async () => {
    const job = track("Job"), phd = track("PhD", 1), other = track("Other", 2);
    const [, applied] = opts(col(job, "Status", true), ["To apply", "Applied"]);
    const [, , submitted] = opts(col(phd, "Status", true), ["To apply", "In progress", "submitted"]);
    opts(col(other, "Status", true), ["Open", "Closed"]);
    expect(await getSubmittedStatuses(job)).toEqual([applied]);
    expect(await getSubmittedStatuses(phd)).toEqual([submitted]);
    expect(await getSubmittedStatuses(other)).toEqual([]);
    expect(await isSubmittedStatus(job, applied)).toBe(true);
    expect(await isSubmittedStatus(job, null)).toBe(false);
  });

  it("round-trips, including an empty selection that beats the defaults", async () => {
    const t = track("Job");
    const [a, b, c] = opts(col(t, "Status", true), ["To apply", "Applied", "Interview"]);
    expect(await setSubmittedStatuses(t, [c, b, c])).toEqual({ ok: true });
    expect(await getSubmittedStatuses(t)).toEqual([b, c]);
    expect(await isSubmittedStatus(t, c)).toBe(true);
    expect(await isSubmittedStatus(t, a)).toBe(false);
    expect((await getSubmittedChoices(t)).map((x) => [x.label, x.submitted])).toEqual([["To apply", false], ["Applied", true], ["Interview", true]]);
    expect(await setSubmittedStatuses(t, [])).toEqual({ ok: true });
    expect(await getSubmittedStatuses(t)).toEqual([]);
  });

  it("drops deleted options and a switched status column silently", async () => {
    const t = track("Job");
    const status = col(t, "Status", true), stage = col(t, "Stage", false);
    const [, applied, offer] = opts(status, ["To apply", "Applied", "Offer"]);
    opts(stage, ["Open"]);
    await setSubmittedStatuses(t, [applied, offer]);
    db.delete(columnOptions).where(eq(columnOptions.id, offer)).run();
    expect(await getSubmittedStatuses(t)).toEqual([applied]);
    expect((await setStatusColumn(t, stage)).ok).toBe(true);
    expect(await getSubmittedStatuses(t)).toEqual([]);
  });

  it("refuses ids of another track, of a non-status column, unknown ids and unknown tracks, saving nothing", async () => {
    const t = track("Job"), u = track("PhD", 1);
    const [a] = opts(col(t, "Status", true), ["Applied"]);
    const [x] = opts(col(u, "Status", true), ["Submitted"]);
    const [side] = opts(col(t, "Stage", false), ["Open"]);
    for (const bad of [[x], [side], [a, 9999], "1", [null]]) expect(await setSubmittedStatuses(t, bad)).toMatchObject({ ok: false });
    expect(await setSubmittedStatuses(9999, [])).toMatchObject({ ok: false });
    expect(db.select().from(settings).where(eq(settings.key, submittedKey(t))).all()).toEqual([]);
  });

  it("ignores other users' tracks", async () => {
    const t = db.insert(tracks).values({ userId: "someone", name: "Theirs", position: 0 }).returning().get().id;
    db.insert(columns).values({ userId: "someone", trackId: t, name: "Status", type: "single_select", position: 0, isStatus: true }).run();
    expect(await setSubmittedStatuses(t, [])).toMatchObject({ ok: false });
  });

  it("treats a corrupt stored value as unset", async () => {
    const t = track("Job");
    const [a] = opts(col(t, "Status", true), ["Applied"]);
    await setSetting(submittedKey(t), "garbage");
    expect(await getSubmittedStatuses(t)).toEqual([a]);
  });

  it("seed writes the setting for both tracks", async () => {
    runSeed();
    const rows = db.select().from(settings).all().filter((r) => r.key.endsWith(".submitted_statuses"));
    expect(rows).toHaveLength(2);
    for (const t of db.select().from(tracks).all()) {
      const labels = (await getSubmittedChoices(t.id)).filter((c) => c.submitted).map((c) => c.label);
      expect(labels).toEqual([t.name === "Job" ? "Applied" : "Submitted"]);
      expect(db.select().from(settings).where(eq(settings.key, submittedKey(t.id))).get()).toBeDefined();
    }
  });
});

describe("saveSubmittedStatuses action", () => {
  it("saves and refreshes; returns the error and does not refresh on bad input", async () => {
    const t = track("Job");
    const [a] = opts(col(t, "Status", true), ["Applied", "Offer"]);
    expect(await saveSubmittedStatuses(t, [a])).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveSubmittedStatuses(t, [12345])).toMatchObject({ ok: false });
    expect(await saveSubmittedStatuses(t, "x" as unknown as number[])).toMatchObject({ ok: false });
    expect(await saveSubmittedStatuses(NaN, [])).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await getSubmittedStatuses(t)).toEqual([a]);
  });
});
