import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { updateCell } from "@/app/actions/cells";
import { applications, cellValues, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

// refresh() only works inside a real Server Action request.
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let appId: number;
let textCol: number;
let numCol: number;
const mkCol = (type: (typeof columns.$inferInsert)["type"], tid = trackId) =>
  db.insert(columns).values({ userId: "local", trackId: tid, name: type, type, position: 0 }).returning().get().id;
const stored = () => db.select().from(cellValues).all();

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
  textCol = mkCol("text");
  numCol = mkCol("number");
});
afterEach(dropTestDb);

describe("updateCell", () => {
  it("saves trimmed text and a number, and refreshes", async () => {
    expect(await updateCell(appId, textCol, "  Acme  ")).toEqual({ ok: true, value: "Acme" });
    expect(await updateCell(appId, numCol, "4.5")).toEqual({ ok: true, value: 4.5 });
    expect(stored().map((r) => r.valueText ?? r.valueNumber).sort()).toEqual([4.5, "Acme"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("blank deletes the stored value (FR-1.4), not an error", async () => {
    await updateCell(appId, textCol, "x");
    expect(await updateCell(appId, textCol, "")).toEqual({ ok: true, value: null });
    expect(stored()).toHaveLength(0);
  });

  it("invalid number returns an error, keeps the old value and does not refresh", async () => {
    await updateCell(appId, numCol, "3");
    vi.mocked(refresh).mockClear();
    for (const bad of ["abc", "0x10", "1e3", "Infinity"]) {
      expect(await updateCell(appId, numCol, bad)).toEqual({ ok: false, error: "Enter a valid number." });
    }
    expect(stored().map((r) => r.valueNumber)).toEqual([3]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["string application id", "1", 1, "x"],
    ["zero column id", 1, 0, "x"],
    ["float application id", 1.5, 1, "x"],
    ["NaN column id", 1, NaN, "x"],
    ["object value for text", 1, 1, { a: 1 }],
    ["array value for number", 1, 2, [1]],
    ["boolean value for text", 1, 1, true],
  ])("rejects %s without writing", async (_n, a, c, raw) => {
    // ids 1 and 2 are the text and number columns of application 1 in this fixture
    const r = await updateCell(a as number, c as number, raw);
    expect(r.ok).toBe(false);
    expect(stored()).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects another user's application, and a column from another track", async () => {
    const otherTrack = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const foreign = db.insert(applications).values({ userId: "someone-else", trackId, title: "X" }).returning().get().id;
    expect(await updateCell(foreign, textCol, "x")).toEqual({ ok: false, error: "Application not found." });
    expect(await updateCell(appId, mkCol("text", otherTrack), "x")).toEqual({ ok: false, error: "Column not found." });
    expect(await updateCell(9999, textCol, "x")).toEqual({ ok: false, error: "Application not found." });
    expect(stored()).toHaveLength(0);
  });

  it("date: saves YYYY-MM-DD as given, blank deletes, invalid keeps the old date", async () => {
    const d = mkCol("date");
    expect(await updateCell(appId, d, "2026-03-04")).toEqual({ ok: true, value: "2026-03-04" });
    vi.mocked(refresh).mockClear();
    for (const bad of ["2026-02-30", "2026-13-01", "03/04/2026", "2026-3-4"]) {
      expect(await updateCell(appId, d, bad)).toEqual({ ok: false, error: "Enter a valid date as YYYY-MM-DD." });
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(stored().map((r) => r.valueDate)).toEqual(["2026-03-04"]);
    expect(await updateCell(appId, d, "")).toEqual({ ok: true, value: null });
    expect(stored()).toHaveLength(0);
  });

  it("checkbox: true and false are stored as booleans, a non-boolean is rejected and keeps the old value", async () => {
    const k = mkCol("checkbox");
    expect(await updateCell(appId, k, true)).toEqual({ ok: true, value: true });
    expect(stored().map((r) => r.valueBool)).toEqual([true]);
    expect(await updateCell(appId, k, false)).toEqual({ ok: true, value: false });
    expect(stored().map((r) => r.valueBool)).toEqual([false]); // unchecked is a stored false, not a deleted row
    vi.mocked(refresh).mockClear();
    for (const bad of ["true", 1, 0, {}]) {
      expect(await updateCell(appId, k, bad)).toEqual({ ok: false, error: "Checkbox must be true or false." });
    }
    expect(stored().map((r) => r.valueBool)).toEqual([false]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("link: saves a normalised http(s) URL, rejects unsafe ones and keeps the old link", async () => {
    const l = mkCol("link");
    expect(await updateCell(appId, l, " example.com/jobs ")).toEqual({ ok: true, value: "https://example.com/jobs" });
    vi.mocked(refresh).mockClear();
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "https://exa mple.com", "https://example.com/a\nb", 5]) {
      expect((await updateCell(appId, l, bad)).ok).toBe(false);
    }
    expect(stored().map((r) => r.valueText)).toEqual(["https://example.com/jobs"]);
    expect(refresh).not.toHaveBeenCalled();
  });
});
