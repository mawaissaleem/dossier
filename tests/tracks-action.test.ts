import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createTrack, deleteTrack, fetchTrackDeleteImpact, setStarred, updateTrack } from "@/app/actions/tracks";
import { tracks } from "@/lib/db/schema";
import { getStarredTrackIds, listTracks } from "@/lib/db/tracks";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
});
afterEach(dropTestDb);

const none = { applications: 0, columns: 1, submissions: 0, notes: 0, files: 0 };

describe("track actions", () => {
  it("createTrack adds and refreshes; a refusal shows the error and does not refresh", async () => {
    expect(await createTrack("Job", "job")).toMatchObject({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await createTrack("job", "blank")).toEqual({ ok: false, error: "A track with this name already exists." });
    expect(await createTrack("X", "nope")).toMatchObject({ ok: false });
    expect(await createTrack(42 as unknown as string, "job")).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await listTracks()).toHaveLength(1);
  });

  it("updateTrack checks its arguments, renames, recolours and refreshes only on success", async () => {
    const r = await createTrack("Job", "blank");
    if (!r.ok) throw new Error(r.error);
    vi.mocked(refresh).mockClear();
    for (const id of [0, -1, 1.5, NaN, "1" as unknown as number]) expect(await updateTrack(id, "X", "red")).toEqual({ ok: false, error: "Track not found." });
    expect(await updateTrack(r.id, 5 as unknown as string, "red")).toMatchObject({ ok: false });
    expect(await updateTrack(r.id, "X", "#fff")).toMatchObject({ ok: false });
    expect(refresh).not.toHaveBeenCalled();
    expect(await updateTrack(r.id, "Work", "teal")).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await listTracks())[0]).toMatchObject({ name: "Work", color: "teal" });
  });

  it("setStarred checks its arguments, stars and unstars, and refreshes only on success", async () => {
    const r = await createTrack("Job", "blank");
    if (!r.ok) throw new Error(r.error);
    vi.mocked(refresh).mockClear();
    for (const id of [0, -1, 1.5, NaN, "1" as unknown as number]) expect(await setStarred(id, true)).toEqual({ ok: false, error: "Track not found." });
    for (const flag of ["true", 1, null, undefined] as unknown[]) expect(await setStarred(r.id, flag as boolean)).toEqual({ ok: false, error: "Track not found." });
    expect(await setStarred(9999, true)).toEqual({ ok: false, error: "Track not found." });
    expect(refresh).not.toHaveBeenCalled();
    expect(await setStarred(r.id, true)).toEqual({ ok: true });
    expect(await getStarredTrackIds()).toEqual(new Set([r.id]));
    expect(await setStarred(r.id, false)).toEqual({ ok: true });
    expect(await getStarredTrackIds()).toEqual(new Set());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("deleteTrack needs confirm, the typed name and the shown counts; it does not refresh (the client leaves the page)", async () => {
    const r = await createTrack("Job", "blank");
    if (!r.ok) throw new Error(r.error);
    const impact = await fetchTrackDeleteImpact(r.id);
    expect(impact).toEqual({ ok: true, name: "Job", ...none });
    expect(await fetchTrackDeleteImpact(0)).toMatchObject({ ok: false });
    expect(await fetchTrackDeleteImpact(9999)).toMatchObject({ ok: false });

    expect(await deleteTrack(r.id, false as unknown as true, "Job", none)).toMatchObject({ ok: false });
    expect(await deleteTrack(r.id, true, "Jo", none)).toMatchObject({ ok: false });
    expect(await deleteTrack(r.id, true, "Job", { ...none, columns: -1 })).toMatchObject({ ok: false });
    expect(await deleteTrack(r.id, true, "Job", { ...none, notes: "0" as unknown as number })).toMatchObject({ ok: false });
    expect(await deleteTrack(r.id, true, "Job", null as never)).toMatchObject({ ok: false });
    expect(await deleteTrack(r.id, true, "Job", { ...none, files: 3 })).toMatchObject({ ok: false });
    expect(db.select().from(tracks).all()).toHaveLength(1);

    vi.mocked(refresh).mockClear();
    expect(await deleteTrack(r.id, true, "Job", none)).toEqual({ ok: true });
    expect(refresh).not.toHaveBeenCalled();
    expect(db.select().from(tracks).all()).toEqual([]);
  });
});
