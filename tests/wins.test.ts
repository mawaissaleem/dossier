import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveWinStatuses } from "@/app/actions/settings";
import { getWins } from "@/lib/db/wins";
import { activityEvents, applications, cellValues, columnOptions, columns, settings, tracks } from "@/lib/db/schema";
import { getWinChoices, setWinStatuses, winKey, winStatusIds } from "@/lib/db/track-settings";
import { setSetting } from "@/lib/db/settings";
import { noWinsText, orderWins, resolveWinStatuses, winAge, winCountsText } from "@/lib/wins";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

describe("pure helpers", () => {
  const o = [{ id: 1, label: "To apply" }, { id: 2, label: " INTERVIEW " }, { id: 3, label: "offer" }, { id: 4, label: "Rejected" }];
  it("defaults to Interview / Offer by label when unset or unreadable; a saved list wins, even empty; unknown ids dropped", () => {
    expect(resolveWinStatuses(undefined, o)).toEqual([2, 3]);
    expect(resolveWinStatuses("nope", o)).toEqual([2, 3]);
    expect(resolveWinStatuses([4, 99], o)).toEqual([4]);
    expect(resolveWinStatuses([], o)).toEqual([]);
  });
  it("orders newest first, ties by lower id, without changing the input", () => {
    const input = [{ id: 3, since: 5 }, { id: 2, since: 9 }, { id: 1, since: 5 }, { id: 4, since: 9 }];
    expect(orderWins(input).map((w) => w.id)).toEqual([2, 4, 1, 3]);
    expect(input[0].id).toBe(3);
  });
  it("counts per label across tracks in configured order, no zero entries, simple plural", () => {
    const wins = [{ label: "Offer" }, { label: "Interview" }, { label: "interview" }];
    expect(winCountsText(wins, ["Interview", "Offer", "Interview", "Offer"])).toBe("2 interviews · 1 offer");
    expect(winCountsText([{ label: "Offer" }], ["Interview", "Offer"])).toBe("1 offer");
    expect(winCountsText([{ label: "Callbacks" }, { label: "Callbacks" }], ["Callbacks"])).toBe("2 callbacks");
  });
  it("empty text from the actual labels", () => {
    expect(noWinsText(["Interview", "Offer", "Interview"])).toBe("No interviews or offers yet");
    expect(noWinsText(["Interview"])).toBe("No interviews yet");
    expect(noWinsText(["A", "B", "C"])).toBe("No as, bs or cs yet");
  });
  it("relative age in local days", () => {
    const at = (d: string) => new Date(`${d}T12:00:00`).getTime();
    expect(winAge(at("2026-11-12"), "2026-11-15")).toEqual({ text: "3 days ago", date: "12 Nov 2026" });
    expect(winAge(at("2026-11-15"), "2026-11-15")?.text).toBe("today");
    expect(winAge(at("2026-11-14"), "2026-11-15")?.text).toBe("yesterday");
    expect(winAge(NaN, "2026-11-15")).toBeNull();
  });
});

describe("win statuses and getWins (data layer)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
  afterEach(dropTestDb);

  function track(name: string, position: number, userId = "local") {
    const t = db.insert(tracks).values({ userId, name, position }).returning().get().id;
    const status = db.insert(columns).values({ userId, trackId: t, name: "Status", type: "single_select", position: 0, isStatus: true }).returning().get().id;
    const opt = (label: string, p: number) => db.insert(columnOptions).values({ userId, columnId: status, label, color: "blue", position: p }).returning().get().id;
    const [todo, interview, offer] = [opt("To apply", 0), opt("Interview", 1), opt("Offer", 2)];
    // `at` = the day the status change into `to` was logged (ms); none = no event, so updated_at is used
    const add = (title: string, to: number | null, o: { archived?: boolean; at?: number; updated?: number; uid?: string } = {}) => {
      const uid = o.uid ?? userId;
      const id = db.insert(applications).values({ userId: uid, trackId: t, title, archived: o.archived ?? false, updatedAt: new Date(o.updated ?? 1000) }).returning().get().id;
      if (to !== null) db.insert(cellValues).values({ userId: uid, applicationId: id, columnId: status, valueOptionId: to }).run();
      if (o.at !== undefined) db.insert(activityEvents).values({ userId: uid, applicationId: id, kind: "status_changed", occurredAt: new Date(o.at), details: JSON.stringify({ columnId: status, fromOptionId: todo, fromLabel: "To apply", toOptionId: to, toLabel: "x" }) }).run();
      return id;
    };
    return { t, status, todo, interview, offer, add };
  }

  it("default until saved: Interview and Offer; saved list wins even when empty", async () => {
    const j = track("Job", 0);
    expect(winStatusIds(j.t)).toEqual([j.interview, j.offer]);
    expect((await getWinChoices(j.t)).map((c) => [c.label, c.on])).toEqual([["To apply", false], ["Interview", true], ["Offer", true]]);
    expect(await setWinStatuses(j.t, [j.offer])).toEqual({ ok: true });
    expect(winStatusIds(j.t)).toEqual([j.offer]);
    expect(await setWinStatuses(j.t, [])).toEqual({ ok: true });
    expect(winStatusIds(j.t)).toEqual([]);
    expect(db.select().from(settings).where(eq(settings.key, winKey(j.t))).get()?.value).toBe("[]");
  });

  it("refuses ids that are not this track's status options, saving nothing; unknown and other users' tracks fail", async () => {
    const j = track("Job", 0), p = track("PhD", 1);
    for (const bad of [[p.offer], [j.offer, 9999], "1", [null], [1.5]]) expect(await setWinStatuses(j.t, bad)).toMatchObject({ ok: false });
    expect(await setWinStatuses(9999, [])).toMatchObject({ ok: false });
    const theirs = track("Theirs", 2, "someone");
    expect(await setWinStatuses(theirs.t, [])).toMatchObject({ ok: false });
    expect(db.select().from(settings).where(eq(settings.key, winKey(j.t))).all()).toEqual([]);
  });

  it("an option deleted later is ignored", async () => {
    const j = track("Job", 0);
    await setWinStatuses(j.t, [j.interview, j.offer]);
    db.delete(columnOptions).where(eq(columnOptions.id, j.offer)).run();
    expect(winStatusIds(j.t)).toEqual([j.interview]);
    const { labels } = await getWins();
    expect(labels).toEqual(["Interview"]);
  });

  it("lists current wins newest first by the status change into it (else updated_at), archived included, ties by id", async () => {
    const j = track("Job", 0), p = track("PhD", 1);
    const a = j.add("old interview", j.interview, { at: 1_000_000 });
    const b = j.add("new offer", j.offer, { at: 5_000_000 });
    const c = j.add("archived interview", j.interview, { at: 3_000_000, archived: true });
    const d = p.add("no event", p.offer, { updated: 4_000_000 });
    const e = p.add("tie with d", p.offer, { updated: 4_000_000 });
    j.add("not a win", j.todo, { at: 9_000_000 });
    j.add("no status", null);
    // an older event into a different status must not count: the newest into the *current* one does
    const f = j.add("moved back", j.interview, { at: 2_000_000 });
    db.insert(activityEvents).values({ userId: "local", applicationId: f, kind: "status_changed", occurredAt: new Date(8_000_000), details: JSON.stringify({ columnId: j.status, toOptionId: j.todo }) }).run();
    db.insert(activityEvents).values({ userId: "local", applicationId: f, kind: "status_changed", occurredAt: new Date(8_500_000), details: "{ not json" }).run(); // garbled: ignored, no crash
    const { labels, wins } = await getWins();
    expect(labels).toEqual(["Interview", "Offer", "Interview", "Offer"]);
    expect(wins.map((w) => w.id)).toEqual([b, d, e, c, f, a]);
    expect(wins.find((w) => w.id === c)).toMatchObject({ archived: true, trackName: "Job", label: "Interview", since: 3_000_000 });
    expect(wins.find((w) => w.id === d)).toMatchObject({ trackName: "PhD", since: 4_000_000 });
  });

  it("excludes another user's applications and tracks; saved-empty on every track gives no labels (card hidden)", async () => {
    const j = track("Job", 0), theirs = track("Theirs", 1, "someone");
    theirs.add("secret", theirs.offer, { uid: "someone", at: 1 });
    j.add("mine", j.offer, { at: 2 });
    expect((await getWins()).wins.map((w) => w.title)).toEqual(["mine"]);
    await setSetting(winKey(j.t), []);
    expect(await getWins()).toEqual({ labels: [], wins: [] });
  });

  it("seed writes win_statuses for both tracks (Interview + Offer)", async () => {
    runSeed();
    runSeed(); // idempotent
    const rows = db.select().from(settings).all().filter((r) => r.key.endsWith(".win_statuses"));
    expect(rows).toHaveLength(2);
    for (const t of db.select().from(tracks).all()) {
      expect((await getWinChoices(t.id)).filter((c) => c.on).map((c) => c.label)).toEqual(["Interview", "Offer"]);
    }
  });

  it("saveWinStatuses saves and refreshes; bad input is an error and does not refresh", async () => {
    const j = track("Job", 0);
    expect(await saveWinStatuses(j.t, [j.offer])).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveWinStatuses(j.t, [12345])).toMatchObject({ ok: false });
    expect(await saveWinStatuses(j.t, "x")).toMatchObject({ ok: false });
    expect(await saveWinStatuses(NaN, [])).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(winStatusIds(j.t)).toEqual([j.offer]);
  });
});
