import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { recordTrackView as recordAction } from "@/app/actions/tracks";
import { getRecentlyViewed, RECENTLY_VIEWED_KEY, recordTrackView } from "@/lib/db/recently-viewed";
import { settings, tracks } from "@/lib/db/schema";
import { createTrackFromTemplate, deleteTrack, getTrackDeleteImpact } from "@/lib/db/tracks";
import { setSetting } from "@/lib/db/settings";
import { MAX_RECENTLY_VIEWED, onlyExisting, parseViewed, recordViewed, type ViewedTrack } from "@/lib/recently-viewed";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const v = (trackId: number, view: "table" | "board", at: number): ViewedTrack => ({ trackId, view, at });

describe("recently viewed list (pure)", () => {
  it("opening a track puts it first; the same track and view again replaces its older entry", () => {
    const list = recordViewed(recordViewed([], v(1, "table", 10)), v(2, "table", 20));
    expect(recordViewed(list, v(1, "table", 30))).toEqual([v(1, "table", 30), v(2, "table", 20)]);
  });
  it("the same track in the other view is its own entry", () => {
    expect(recordViewed([v(1, "table", 10)], v(1, "board", 20))).toEqual([v(1, "board", 20), v(1, "table", 10)]);
  });
  it("keeps at most six, dropping the oldest", () => {
    let list: ViewedTrack[] = [];
    for (let i = 1; i <= 9; i++) list = recordViewed(list, v(i, "table", i));
    expect(list).toHaveLength(MAX_RECENTLY_VIEWED);
    expect(list.map((e) => e.trackId)).toEqual([9, 8, 7, 6, 5, 4]);
  });
  it("does not change the list it is given", () => {
    const list = [v(1, "table", 1)];
    recordViewed(list, v(2, "table", 2));
    expect(list).toEqual([v(1, "table", 1)]);
  });
  it("deleted tracks are filtered out, keeping the order", () => {
    expect(onlyExisting([v(3, "table", 3), v(2, "board", 2), v(1, "table", 1)], new Set([1, 3]))).toEqual([v(3, "table", 3), v(1, "table", 1)]);
  });
  it("parsing cleans whatever was stored: wrong shapes dropped, newest first, deduped, capped", () => {
    const stored = [v(1, "table", 5), v(2, "board", 9), v(1, "table", 7), { trackId: 0, view: "table", at: 1 }, { trackId: 1.5, view: "table", at: 1 }, { trackId: 3, view: "grid", at: 1 }, { trackId: 4, view: "table", at: "x" }, null, "x", 7];
    expect(parseViewed(stored)).toEqual([v(2, "board", 9), v(1, "table", 7)]);
    for (const bad of [undefined, null, "x", 5, {}]) expect(parseViewed(bad)).toEqual([]);
    expect(parseViewed(Array.from({ length: 20 }, (_, i) => v(i + 1, "table", i)))).toHaveLength(MAX_RECENTLY_VIEWED);
  });
});

const stored = async () => (await getRecentlyViewed()).map((e) => ({ trackId: e.trackId, view: e.view, at: e.at }));

describe("recording a view (data layer and action)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
  afterEach(dropTestDb);

  const add = async (name: string) => { const r = await createTrackFromTemplate(name, "blank"); if (!r.ok) throw new Error(r.error); return r.id; };

  it("stores one settings row, newest first, deduped by track and view", async () => {
    const [a, b] = [await add("Job"), await add("PhD")];
    await recordTrackView(a, "table", 100);
    await recordTrackView(b, "board", 200);
    await recordTrackView(a, "table", 300);
    expect(await stored()).toEqual([v(a, "table", 300), v(b, "board", 200)]);
    expect((await getRecentlyViewed(300 + 3 * 3_600_000)).map((e) => e.when)).toEqual(["3 hours ago", "3 hours ago"]); // the age in words, computed at the request
    expect(db.select().from(settings).all().filter((s) => s.key === RECENTLY_VIEWED_KEY)).toHaveLength(1);
  });

  it("refuses an unknown view, a missing track and another user's track, and writes nothing", async () => {
    const a = await add("Job");
    const other = db.insert(tracks).values({ userId: "someone-else", name: "Other", position: 5 }).returning().get().id;
    expect(await recordTrackView(a, "grid")).toEqual({ ok: false, error: "Track not found." });
    expect(await recordTrackView(9999, "table")).toMatchObject({ ok: false });
    expect(await recordTrackView(other, "table")).toMatchObject({ ok: false });
    expect(await stored()).toEqual([]);
  });

  it("reads through a hand-edited or unreadable value as an empty list", async () => {
    await setSetting(RECENTLY_VIEWED_KEY, { not: "a list" });
    expect(await stored()).toEqual([]);
    db.update(settings).set({ value: "{" }).run();
    expect(await stored()).toEqual([]);
  });

  it("a deleted track stays in the stored list but the page filters it (onlyExisting)", async () => {
    const [a, b] = [await add("Job"), await add("PhD")];
    await recordTrackView(a, "table", 1);
    await recordTrackView(b, "table", 2);
    await deleteTrack(a, "Job", (await getTrackDeleteImpact(a))!);
    expect(onlyExisting(await getRecentlyViewed(), new Set([b])).map((e) => e.trackId)).toEqual([b]);
  });

  it("the action checks its arguments (it runs on any POST), records, and does not refresh the page", async () => {
    const a = await add("Job");
    for (const id of [0, -1, 1.5, NaN, "1" as unknown as number]) expect(await recordAction(id, "table")).toEqual({ ok: false, error: "Track not found." });
    expect(await recordAction(a, 5 as unknown as string)).toEqual({ ok: false, error: "Track not found." });
    expect(await stored()).toEqual([]);
    expect(await recordAction(a, "board")).toEqual({ ok: true });
    expect((await stored()).map((e) => [e.trackId, e.view])).toEqual([[a, "board"]]);
    expect(refresh).not.toHaveBeenCalled();
  });
});
