import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createApplication, updateApplication } from "@/app/actions/applications";
import { BAD_DATE, buildValues, changedState, initialState } from "@/lib/application-form";
import { getApplicationDetail } from "@/lib/db/applications";
import { listColumns } from "@/lib/db/columns";
import { setCellValue } from "@/lib/db/cells";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

type Type = (typeof columns.$inferInsert)["type"];
let db: ReturnType<typeof useTestDb>;
let trackId: number;
let appId: number;
let ids: Record<Type, number>;
let optA: number, optB: number;
const col = (name: string, type: Type, position: number, tid = trackId, userId = "local") =>
  db.insert(columns).values({ userId, trackId: tid, name, type, position }).returning().get().id;
const valuesOf = async (id = appId) => (await getApplicationDetail(id))!.values;
const cellCount = () => db.select().from(cellValues).all().length;

beforeEach(async () => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  ids = { text: col("Notes", "text", 0), number: col("Salary", "number", 1), date: col("Deadline", "date", 2), link: col("Posting", "link", 3), checkbox: col("Referred", "checkbox", 4), single_select: col("Stage", "single_select", 5) };
  optA = db.insert(columnOptions).values({ userId: "local", columnId: ids.single_select, label: "A", color: "blue", position: 0 }).returning().get().id;
  optB = db.insert(columnOptions).values({ userId: "local", columnId: ids.single_select, label: "B", color: "red", position: 1 }).returning().get().id;
  const r = await createApplication("Acme", trackId, [{ columnId: ids.text, value: "old" }, { columnId: ids.number, value: 1 }, { columnId: ids.single_select, value: optA }]);
  appId = r.ok ? r.id : 0;
  vi.mocked(refresh).mockClear();
});
afterEach(dropTestDb);

describe("updateApplication", () => {
  it("updates each of the six types and refreshes", async () => {
    const r = await updateApplication(appId, "Acme 2", [
      { columnId: ids.text, value: " new " }, { columnId: ids.number, value: "52000.5" }, { columnId: ids.date, value: "2026-03-04" },
      { columnId: ids.link, value: "example.com" }, { columnId: ids.checkbox, value: true }, { columnId: ids.single_select, value: String(optB) },
    ]);
    expect(r).toEqual({ ok: true });
    expect(await valuesOf()).toEqual({ [ids.text]: "new", [ids.number]: 52000.5, [ids.date]: "2026-03-04", [ids.link]: "https://example.com/", [ids.checkbox]: true, [ids.single_select]: optB });
    expect((await getApplicationDetail(appId))!.title).toBe("Acme 2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sets an unchecked box as false (a row), and a blank value deletes the cell row", async () => {
    await updateApplication(appId, "Acme", [{ columnId: ids.checkbox, value: false }]);
    expect((await valuesOf())[ids.checkbox]).toBe(false);
    const before = cellCount();
    const r = await updateApplication(appId, "Acme", [{ columnId: ids.text, value: "  " }, { columnId: ids.number, value: null }, { columnId: ids.single_select, value: "" }]);
    expect(r).toEqual({ ok: true });
    expect(await valuesOf()).toMatchObject({ [ids.text]: null, [ids.number]: null, [ids.single_select]: null, [ids.checkbox]: false });
    expect(cellCount()).toBe(before - 3);
  });

  it("does not apply column defaults", async () => {
    db.update(columns).set({ defaultValue: "Remote" }).where(eq(columns.id, ids.link)).run();
    await updateApplication(appId, "Acme", [{ columnId: ids.text, value: "x" }]);
    expect((await valuesOf())[ids.link]).toBeNull();
  });

  it("leaves cells it was not given alone, even if they changed after the page loaded", async () => {
    await setCellValue(appId, ids.number, "99"); // inline edit in another tab
    const r = await updateApplication(appId, "Acme", [{ columnId: ids.text, value: "edited" }]);
    expect(r).toEqual({ ok: true });
    expect(await valuesOf()).toMatchObject({ [ids.number]: 99, [ids.text]: "edited", [ids.single_select]: optA });
  });

  it("updates the title, trimmed, with no values; rejects an empty or too long one", async () => {
    expect(await updateApplication(appId, "  New  ", [])).toEqual({ ok: true });
    expect((await getApplicationDetail(appId))!.title).toBe("New");
    expect(await updateApplication(appId, "   ", [])).toEqual({ ok: false, error: "Title is required." });
    expect(await updateApplication(appId, 5 as never, [])).toEqual({ ok: false, error: "Title is required." });
    expect(await updateApplication(appId, "x".repeat(301), [])).toEqual({ ok: false, error: "Title must be at most 300 characters." });
    expect(await updateApplication(appId, "x".repeat(300), [])).toEqual({ ok: true });
  });

  it.each([
    ["number", "abc", "Salary: Enter a valid number."],
    ["date", "2026-02-30", "Deadline: Enter a valid date as YYYY-MM-DD."],
    ["link", "has space", "Posting: Enter a valid http or https link, without spaces."],
    ["checkbox", "yes", "Referred: Checkbox must be true or false."],
    ["single_select", "x", "Stage: Choose a valid option."],
    ["text", 5, "Notes: Text must be a string."],
    ["text", "x".repeat(10_001), "Notes: Text must be at most 10,000 characters."],
    ["link", `a.com/${"x".repeat(10_000)}`, "Posting: Link must be at most 10,000 characters."],
  ] as const)("rejects an invalid %s value, naming the column, and changes nothing (title and other values included)", async (type, value, error) => {
    const before = await valuesOf();
    const good = type === "text" ? { columnId: ids.number, value: "7" } : { columnId: ids.text, value: "valid" }; // a valid entry before it: must not be kept
    const r = await updateApplication(appId, "Changed", [good, { columnId: ids[type], value } as never]);
    expect(r).toEqual({ ok: false, error });
    expect(await valuesOf()).toEqual(before);
    expect((await getApplicationDetail(appId))!.title).toBe("Acme");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("edit form: a bad-input date is refused with a named error and the stored date is kept", async () => {
    await updateApplication(appId, "Acme", [{ columnId: ids.date, value: "2026-12-01" }]);
    const cols = await listColumns(trackId);
    const init = initialState(cols, await valuesOf());
    const r = await updateApplication(appId, "Acme", buildValues(cols, changedState(cols, { ...init, [ids.date]: BAD_DATE }, init)));
    expect(r).toEqual({ ok: false, error: "Deadline: Enter a valid date as YYYY-MM-DD." });
    expect((await valuesOf())[ids.date]).toBe("2026-12-01");
  });

  it("rejects an option of another column and a missing option", async () => {
    const other = col("Other", "single_select", 6);
    const foreign = db.insert(columnOptions).values({ userId: "local", columnId: other, label: "Z", color: "blue", position: 0 }).returning().get().id;
    expect(await updateApplication(appId, "Acme", [{ columnId: ids.single_select, value: foreign }])).toEqual({ ok: false, error: "Stage: Choose a valid option." });
    expect(await updateApplication(appId, "Acme", [{ columnId: ids.single_select, value: 99999 }])).toMatchObject({ ok: false });
    expect((await valuesOf())[ids.single_select]).toBe(optA);
  });

  it("rejects a column of another track, another user, a deleted column, or one given twice", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const otherTrack = col("X", "text", 0, t2);
    const otherUser = col("Y", "text", 0, trackId, "someone-else");
    const gone = col("Gone", "text", 9);
    db.delete(columns).where(eq(columns.id, gone)).run();
    for (const columnId of [otherTrack, otherUser, gone]) {
      expect(await updateApplication(appId, "Acme", [{ columnId, value: "v" }])).toMatchObject({ ok: false, error: expect.stringContaining("Reload") });
    }
    expect(await updateApplication(appId, "Acme", [{ columnId: ids.text, value: "a" }, { columnId: ids.text, value: "b" }])).toEqual({ ok: false, error: "Notes: given twice." });
    expect((await valuesOf())[ids.text]).toBe("old");
  });

  it("rejects another user's application and a missing one, changing nothing", async () => {
    const t = db.insert(tracks).values({ userId: "someone-else", name: "Theirs", position: 0 }).returning().get().id;
    const theirs = db.insert(applications).values({ userId: "someone-else", trackId: t, title: "Theirs" }).returning().get().id;
    expect(await updateApplication(theirs, "Mine now", [])).toEqual({ ok: false, error: "Application not found." });
    expect(db.select().from(applications).where(eq(applications.id, theirs)).get()!.title).toBe("Theirs");
    expect(await updateApplication(99999, "A", [])).toEqual({ ok: false, error: "Application not found." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("edits an archived application and leaves it archived", async () => {
    db.update(applications).set({ archived: true }).where(eq(applications.id, appId)).run();
    expect(await updateApplication(appId, "Still archived", [{ columnId: ids.text, value: "z" }])).toEqual({ ok: true });
    const d = (await getApplicationDetail(appId))!;
    expect(d).toMatchObject({ title: "Still archived", archived: true });
    expect(d.values[ids.text]).toBe("z");
  });

  it("keeps one row per cell when the same cell is updated twice", async () => {
    await updateApplication(appId, "Acme", [{ columnId: ids.text, value: "one" }]);
    await updateApplication(appId, "Acme", [{ columnId: ids.text, value: "two" }]);
    expect(db.select().from(cellValues).where(and(eq(cellValues.applicationId, appId), eq(cellValues.columnId, ids.text))).all()).toHaveLength(1);
  });

  it.each([
    ["not an array", { columnId: 1, value: "x" }],
    ["undefined", undefined],
    ["null entry", [null]],
    ["string columnId", [{ columnId: "1", value: "x" }]],
    ["object value", [{ columnId: 1, value: { a: 1 } }]],
    ["missing value", [{ columnId: 1 }]],
    ["too long text", [{ columnId: 1, value: "x".repeat(100_001) }]],
    ["too many entries", Array.from({ length: 201 }, () => ({ columnId: 1, value: null }))],
  ])("rejects a bad payload shape: %s", async (_n, payload) => {
    expect(await updateApplication(appId, "Acme", payload as never)).toEqual({ ok: false, error: "Invalid form data." });
  });

  it.each([0, -1, 1.5, "1", null])("rejects a bad application id %j", async (id) => {
    expect(await updateApplication(id as never, "A", [])).toEqual({ ok: false, error: "Application not found." });
  });
});
