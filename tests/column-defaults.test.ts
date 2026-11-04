import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createApplication } from "@/app/actions/applications";
import { setColumnDefault } from "@/app/actions/columns";
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
const stored = (id: number) => db.select().from(columns).where(eq(columns.id, id)).get()!.defaultValue;
const newApp = async (title = "A") => {
  const r = await createApplication(title, trackId);
  if (!r.ok) throw new Error(r.error);
  return r.id;
};

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  ids = { text: col("t", "text", 0), number: col("n", "number", 1), date: col("d", "date", 2), link: col("l", "link", 3), checkbox: col("c", "checkbox", 4), single_select: col("s", "single_select", 5) };
  optA = db.insert(columnOptions).values({ userId: "local", columnId: ids.single_select, label: "A", color: "blue", position: 0 }).returning().get().id;
  optB = db.insert(columnOptions).values({ userId: "local", columnId: ids.single_select, label: "B", color: "red", position: 1 }).returning().get().id;
});
afterEach(dropTestDb);

describe("setColumnDefault", () => {
  it("sets, then clears, a default for each of the six types", async () => {
    const cases = () => [
      ["text", " Remote ", "Remote"], ["number", "4.5", "4.5"], ["date", "2026-03-04", "2026-03-04"],
      ["link", "example.com", "https://example.com/"], ["checkbox", true, "true"], ["single_select", optB, String(optB)],
    ] as const;
    for (const [type, raw, text] of cases()) {
      expect(await setColumnDefault(ids[type], raw)).toEqual({ ok: true });
      expect(stored(ids[type])).toBe(text);
    }
    expect(await setColumnDefault(ids.checkbox, false)).toEqual({ ok: true });
    expect(stored(ids.checkbox)).toBe("false");
    for (const [type] of cases()) {
      expect(await setColumnDefault(ids[type], type === "text" ? "" : null)).toEqual({ ok: true });
      expect(stored(ids[type])).toBeNull();
    }
    expect(refresh).toHaveBeenCalledTimes(cases().length * 2 + 1);
  });

  it.each([
    ["number", "abc"], ["number", true], ["date", "2026-02-30"], ["link", "javascript:alert(1)"], ["checkbox", "yes"], ["text", 5],
    ["single_select", 99999], ["single_select", "x"], ["single_select", 1.5],
  ] as const)("rejects an invalid %s default %j and changes nothing", async (type, raw) => {
    const r = await setColumnDefault(ids[type], raw as string);
    expect(r.ok).toBe(false);
    expect(stored(ids[type])).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects an option that belongs to another column or another user, and bad ids or value shapes", async () => {
    const other = col("s2", "single_select", 6);
    const foreignOpt = db.insert(columnOptions).values({ userId: "local", columnId: other, label: "X", color: "red", position: 0 }).returning().get().id;
    expect((await setColumnDefault(ids.single_select, foreignOpt)).ok).toBe(false);
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const fcol = col("S", "single_select", 0, t2, "someone-else");
    const fopt = db.insert(columnOptions).values({ userId: "someone-else", columnId: fcol, label: "A", color: "red", position: 0 }).returning().get().id;
    expect((await setColumnDefault(ids.single_select, fopt)).ok).toBe(false);
    for (const id of [0, -1, 1.5, "1", NaN]) expect(await setColumnDefault(id as number, "x")).toEqual({ ok: false, error: "Column not found." });
    for (const v of [{}, [], undefined]) expect((await setColumnDefault(ids.text, v as unknown as string)).ok).toBe(false);
    expect(stored(ids.single_select)).toBeNull();
    expect(stored(ids.text)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects another user's column", async () => {
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = col("T", "text", 0, t2, "someone-else");
    expect(await setColumnDefault(foreign, "x")).toEqual({ ok: false, error: "Column not found." });
    expect(stored(foreign)).toBeNull();
  });
});

describe("createApplication pre-fills defaults", () => {
  it("fills every column that has a default, in the same application, and leaves the rest blank", async () => {
    await setColumnDefault(ids.text, "Remote");
    await setColumnDefault(ids.number, "10");
    await setColumnDefault(ids.date, "2026-01-02");
    await setColumnDefault(ids.link, "example.com");
    await setColumnDefault(ids.checkbox, false);
    await setColumnDefault(ids.single_select, optB);
    const id = await newApp();
    expect((await getApplicationDetail(id))!.values).toEqual({
      [ids.text]: "Remote", [ids.number]: 10, [ids.date]: "2026-01-02", [ids.link]: "https://example.com/", [ids.checkbox]: false, [ids.single_select]: optB,
    });
    const id2 = await newApp("B"); // no defaults on these two
    await setColumnDefault(ids.text, null);
    await setColumnDefault(ids.number, null);
    const id3 = await newApp("C");
    expect(db.select().from(cellValues).where(eq(cellValues.applicationId, id3)).all()).toHaveLength(4);
    expect(db.select().from(cellValues).where(eq(cellValues.applicationId, id2)).all()).toHaveLength(6);
  });

  it("does not change existing applications when a default is set", async () => {
    const old = await newApp("old");
    await setColumnDefault(ids.text, "Remote");
    await setColumnDefault(ids.single_select, optA);
    expect(db.select().from(cellValues).where(eq(cellValues.applicationId, old)).all()).toEqual([]);
    expect((await getApplicationDetail(old))!.values[ids.text]).toBeNull();
    expect((await getApplicationDetail(await newApp("new")))!.values[ids.text]).toBe("Remote");
  });

  it.each([
    ["text", "   "], ["number", "0x10"], ["date", "2026-02-30"], ["link", "javascript:alert(1)"], ["checkbox", "maybe"], ["single_select", "abc"],
    ["single_select", "99999"],
  ] as const)("skips an invalid %s default %j: the application is still created", async (type, text) => {
    db.update(columns).set({ defaultValue: text }).where(eq(columns.id, ids[type])).run();
    const id = await newApp();
    expect((await getApplicationDetail(id))!.values[ids[type]]).toBeNull();
    expect(db.select().from(applications).all()).toHaveLength(1);
  });

  it("skips an option default that belongs to another column", async () => {
    const other = col("s2", "single_select", 6);
    const foreignOpt = db.insert(columnOptions).values({ userId: "local", columnId: other, label: "X", color: "red", position: 0 }).returning().get().id;
    db.update(columns).set({ defaultValue: String(foreignOpt) }).where(eq(columns.id, ids.single_select)).run();
    await setColumnDefault(ids.text, "kept");
    const id = await newApp();
    expect((await getApplicationDetail(id))!.values).toMatchObject({ [ids.single_select]: null, [ids.text]: "kept" });
  });

  it("skips a default option that was deleted by hand", async () => {
    await setColumnDefault(ids.single_select, optA);
    db.delete(columnOptions).where(eq(columnOptions.id, optA)).run();
    expect((await getApplicationDetail(await newApp()))!.values[ids.single_select]).toBeNull();
  });

  it("ignores another user's columns and creates nothing on another user's track", async () => {
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = col("T", "text", 0, t2, "someone-else");
    db.update(columns).set({ defaultValue: "secret" }).where(eq(columns.id, foreign)).run();
    expect(await createApplication("A", t2)).toEqual({ ok: false, error: "Track not found." });
    expect(db.select().from(cellValues).all()).toHaveLength(0);
  });
});
