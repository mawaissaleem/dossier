import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplication } from "@/app/actions/applications";
import { BAD_DATE, buildCreateValues } from "@/lib/application-form";
import { getApplicationDetail } from "@/lib/db/applications";
import { MAX_COLUMNS, addColumn, listColumns, setColumnDefault } from "@/lib/db/columns";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

// What the add form does on submit: build the payload from the columns it rendered with and the touched fields, then call the action.
type Type = (typeof columns.$inferInsert)["type"];
let db: ReturnType<typeof useTestDb>;
let trackId: number;
let id: Record<Type, number>;
let optA: number, optB: number;
const col = (name: string, type: Type, position: number) => db.insert(columns).values({ userId: "local", trackId, name, type, position }).returning().get().id;
const submit = async (title: string, touched: Record<number, string | boolean> = {}, cols?: Awaited<ReturnType<typeof listColumns>>) => {
  const r = await createApplication(title, trackId, buildCreateValues(cols ?? (await listColumns(trackId)), touched));
  return r.ok ? { ...r, values: (await getApplicationDetail(r.id))!.values } : r;
};

beforeEach(async () => {
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  id = { text: col("Location", "text", 0), number: col("Salary", "number", 1), date: col("Deadline", "date", 2), link: col("Posting", "link", 3), checkbox: col("Referred", "checkbox", 4), single_select: col("Priority", "single_select", 5) };
  optA = db.insert(columnOptions).values({ userId: "local", columnId: id.single_select, label: "High", color: "red", position: 0 }).returning().get().id;
  optB = db.insert(columnOptions).values({ userId: "local", columnId: id.single_select, label: "Low", color: "blue", position: 1 }).returning().get().id;
  for (const [c, v] of [[id.text, "Remote"], [id.number, 4.5], [id.date, "2026-03-04"], [id.link, "a.com"], [id.checkbox, true], [id.single_select, optA]] as const) await setColumnDefault(c, v);
});
afterEach(dropTestDb);

describe("add form defaults end to end", () => {
  it("title only creates the application with every default (AT-1)", async () => {
    const r = await submit("Acme");
    expect(r).toMatchObject({ ok: true, values: { [id.text]: "Remote", [id.number]: 4.5, [id.date]: "2026-03-04", [id.link]: "https://a.com/", [id.checkbox]: true, [id.single_select]: optA } });
    // the same through the server-side path with no payload at all
    const bare = await createApplication("Bare", trackId);
    expect(bare.ok && (await getApplicationDetail(bare.id))!.values[id.text]).toBe("Remote");
  });

  it("a cleared pre-filled field saves blank, an unchecked box false, a blank select blank", async () => {
    const r = await submit("A", { [id.text]: "", [id.checkbox]: false, [id.single_select]: "", [id.number]: "  " });
    expect(r).toMatchObject({ ok: true, values: { [id.text]: null, [id.number]: null, [id.checkbox]: false, [id.single_select]: null, [id.date]: "2026-03-04" } });
  });

  it("a changed pre-filled field saves what was typed", async () => {
    const r = await submit("A", { [id.single_select]: String(optB), [id.text]: "Berlin" });
    expect(r).toMatchObject({ ok: true, values: { [id.text]: "Berlin", [id.single_select]: optB } });
  });

  it("invalid and dangling defaults show blank and create blank", async () => {
    db.update(columns).set({ defaultValue: "abc" }).where(eq(columns.id, id.number)).run();
    db.update(columns).set({ defaultValue: "9999" }).where(eq(columns.id, id.single_select)).run();
    const r = await submit("A");
    expect(r).toMatchObject({ ok: true, values: { [id.number]: null, [id.single_select]: null, [id.text]: "Remote" } });
  });

  it("columns without a default stay blank, with no cell row for an untouched checkbox", async () => {
    db.update(columns).set({ defaultValue: null }).where(eq(columns.trackId, trackId)).run();
    const r = await submit("A");
    expect(r.ok).toBe(true);
    expect(db.select().from(cellValues).all()).toEqual([]);
  });

  it("a default changed after the form rendered does not change what is saved", async () => {
    const shown = await listColumns(trackId); // what the open form was rendered with
    await setColumnDefault(id.text, "Berlin"); // another tab changes it
    await setColumnDefault(id.single_select, optB);
    await setColumnDefault(id.checkbox, null);
    const r = await submit("A", {}, shown);
    expect(r).toMatchObject({ ok: true, values: { [id.text]: "Remote", [id.single_select]: optA, [id.checkbox]: true } });
  });

  it("a default option deleted after the form rendered saves nothing and errors", async () => {
    const shown = await listColumns(trackId);
    db.delete(columnOptions).where(eq(columnOptions.id, optA)).run();
    const r = await submit("A", {}, shown);
    expect(r).toMatchObject({ ok: false, error: "Priority: Choose a valid option." });
    expect(db.select().from(applications).all()).toEqual([]);
  });

  it("an existing over-long default (from before the text cap) shows blank and creates blank, not an error", async () => {
    db.update(columns).set({ defaultValue: "x".repeat(10_001) }).where(eq(columns.id, id.text)).run();
    const r = await submit("A");
    expect(r).toMatchObject({ ok: true, values: { [id.text]: null, [id.number]: 4.5 } });
  });

  it("a default at the text cap is sent back as shown and saved", async () => {
    expect(await setColumnDefault(id.text, "x".repeat(10_000))).toEqual({ ok: true });
    expect(await setColumnDefault(id.text, "x".repeat(10_001))).toEqual({ ok: false, error: "Text must be at most 10,000 characters." });
    expect(await submit("A")).toMatchObject({ ok: true, values: { [id.text]: "x".repeat(10_000) } });
  });

  it("a track at the column cap still creates title-only through the form payload, and refuses one more column", async () => {
    db.insert(columns).values(Array.from({ length: MAX_COLUMNS - 6 }, (_, i) => ({ userId: "local", trackId, name: `C${i}`, type: "text" as const, position: i + 6 }))).run(); // one statement: fast
    expect(await submit("A")).toMatchObject({ ok: true, values: { [id.text]: "Remote" } });
    expect(await addColumn({ trackId, name: "One more", type: "text" })).toEqual({ ok: false, error: `A track can have at most ${MAX_COLUMNS} columns.` });
    expect((await listColumns(trackId)).length).toBe(MAX_COLUMNS);
  });

  it("a bad-input date over a pre-filled default is refused with a named error, not saved blank", async () => {
    expect(await submit("A", { [id.date]: BAD_DATE })).toEqual({ ok: false, error: "Deadline: Enter a valid date as YYYY-MM-DD." });
    expect(db.select().from(applications).all()).toEqual([]);
  });
});
