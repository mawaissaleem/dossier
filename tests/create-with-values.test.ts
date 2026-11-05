import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createApplication } from "@/app/actions/applications";
import { getApplicationDetail } from "@/lib/db/applications";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

type Type = (typeof columns.$inferInsert)["type"];
let db: ReturnType<typeof useTestDb>;
let trackId: number;
let ids: Record<Type, number>;
let optA: number, optB: number;
const col = (name: string, type: Type, position: number, tid = trackId, userId = "local") =>
  db.insert(columns).values({ userId, trackId: tid, name, type, position }).returning().get().id;
const counts = () => [db.select().from(applications).all().length, db.select().from(cellValues).all().length];
const valuesOf = async (id: number) => (await getApplicationDetail(id))!.values;

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  ids = { text: col("Notes", "text", 0), number: col("Salary", "number", 1), date: col("Deadline", "date", 2), link: col("Posting", "link", 3), checkbox: col("Referred", "checkbox", 4), single_select: col("Stage", "single_select", 5) };
  optA = db.insert(columnOptions).values({ userId: "local", columnId: ids.single_select, label: "A", color: "blue", position: 0 }).returning().get().id;
  optB = db.insert(columnOptions).values({ userId: "local", columnId: ids.single_select, label: "B", color: "red", position: 1 }).returning().get().id;
});
afterEach(dropTestDb);

describe("createApplication with values", () => {
  it("stores a value for each of the six types", async () => {
    const r = await createApplication("Acme", trackId, [
      { columnId: ids.text, value: " hi " }, { columnId: ids.number, value: "52000.5" }, { columnId: ids.date, value: "2026-03-04" },
      { columnId: ids.link, value: "example.com" }, { columnId: ids.checkbox, value: true }, { columnId: ids.single_select, value: optB },
    ]);
    expect(r.ok).toBe(true);
    expect(await valuesOf(r.ok ? r.id : 0)).toEqual({
      [ids.text]: "hi", [ids.number]: 52000.5, [ids.date]: "2026-03-04", [ids.link]: "https://example.com/", [ids.checkbox]: true, [ids.single_select]: optB,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("accepts a select option sent as a numeric string and an unchecked box", async () => {
    const r = await createApplication("A", trackId, [{ columnId: ids.single_select, value: String(optA) }, { columnId: ids.checkbox, value: false }]);
    expect(r.ok).toBe(true);
    const v = await valuesOf(r.ok ? r.id : 0);
    expect(v[ids.single_select]).toBe(optA);
    expect(v[ids.checkbox]).toBe(false);
  });

  it("applies a default only when the column is omitted, not when it is submitted blank", async () => {
    db.update(columns).set({ defaultValue: "Remote" }).where(eq(columns.id, ids.text)).run();
    db.update(columns).set({ defaultValue: String(optA) }).where(eq(columns.id, ids.single_select)).run();
    const omitted = await createApplication("A", trackId, [{ columnId: ids.number, value: 1 }]);
    expect(await valuesOf(omitted.ok ? omitted.id : 0)).toMatchObject({ [ids.text]: "Remote", [ids.single_select]: optA, [ids.number]: 1 });
    const blank = await createApplication("B", trackId, [{ columnId: ids.text, value: null }, { columnId: ids.single_select, value: "" }]);
    expect(await valuesOf(blank.ok ? blank.id : 0)).toMatchObject({ [ids.text]: null, [ids.single_select]: null });
    const none = await createApplication("C", trackId); // title-only is the same path
    expect(await valuesOf(none.ok ? none.id : 0)).toMatchObject({ [ids.text]: "Remote", [ids.single_select]: optA });
  });

  it.each([
    ["number", "abc", "Salary: Enter a valid number."],
    ["date", "2026-02-30", "Deadline: Enter a valid date as YYYY-MM-DD."],
    ["link", "has space", "Posting: Enter a valid http or https link, without spaces."],
    ["checkbox", "yes", "Referred: Checkbox must be true or false."],
    ["single_select", "x", "Stage: Choose a valid option."],
    ["text", 5, "Notes: Text must be a string."],
  ] as const)("rejects an invalid %s value, naming the column, and creates nothing", async (type, value, error) => {
    const r = await createApplication("A", trackId, [{ columnId: ids[type], value } as never]);
    expect(r).toEqual({ ok: false, error });
    expect(counts()).toEqual([0, 0]);
  });

  it("rejects an option that belongs to another column", async () => {
    const other = col("Other", "single_select", 6);
    const foreign = db.insert(columnOptions).values({ userId: "local", columnId: other, label: "Z", color: "blue", position: 0 }).returning().get().id;
    expect(await createApplication("A", trackId, [{ columnId: ids.single_select, value: foreign }])).toEqual({ ok: false, error: "Stage: Choose a valid option." });
    expect(await createApplication("A", trackId, [{ columnId: ids.single_select, value: 99999 }])).toMatchObject({ ok: false });
    expect(counts()).toEqual([0, 0]);
  });

  it("rejects a column of another track, another user, or one that does not exist", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const otherTrack = col("X", "text", 0, t2);
    const otherUser = col("Y", "text", 0, trackId, "someone-else");
    for (const columnId of [otherTrack, otherUser, 99999]) {
      const r = await createApplication("A", trackId, [{ columnId, value: "v" }]);
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Reload") });
    }
    expect(counts()).toEqual([0, 0]);
  });

  it("rejects a column given twice", async () => {
    const r = await createApplication("A", trackId, [{ columnId: ids.text, value: "a" }, { columnId: ids.text, value: "b" }]);
    expect(r).toEqual({ ok: false, error: "Notes: given twice." });
    expect(counts()).toEqual([0, 0]);
  });

  it.each([
    ["not an array", { columnId: 1, value: "x" }],
    ["a string", "x"],
    ["null entry", [null]],
    ["array entry", [[1, "x"]]],
    ["string columnId", [{ columnId: "1", value: "x" }]],
    ["zero columnId", [{ columnId: 0, value: "x" }]],
    ["object value", [{ columnId: 1, value: { a: 1 } }]],
    ["array value", [{ columnId: 1, value: ["x"] }]],
    ["missing value", [{ columnId: 1 }]],
    ["too long text", [{ columnId: 1, value: "x".repeat(10_001) }]],
    ["too many entries", Array.from({ length: 201 }, () => ({ columnId: 1, value: null }))],
  ])("rejects a bad payload shape: %s", async (_n, payload) => {
    expect(await createApplication("A", trackId, payload as never)).toEqual({ ok: false, error: "Invalid form data." });
    expect(counts()).toEqual([0, 0]);
  });

  it("does not refresh on failure", async () => {
    await createApplication("A", trackId, [{ columnId: ids.number, value: "abc" }]);
    expect(refresh).not.toHaveBeenCalled();
  });
});
