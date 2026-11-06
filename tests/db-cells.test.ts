import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCellValue, setCellValue } from "@/lib/db/cells";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let appId: number;
const col = (type: (typeof columns.$inferInsert)["type"], over: Partial<typeof columns.$inferInsert> = {}) =>
  db.insert(columns).values({ userId: "local", trackId, name: `${type}-${Math.random()}`, type, position: 0, ...over }).returning().get().id;
const rows = () => db.select().from(cellValues).all();

beforeEach(() => {
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
});
afterEach(dropTestDb);

describe("setCellValue / getCellValue", () => {
  it("writes and reads each of the 6 types", async () => {
    const sel = col("single_select");
    const opt = db.insert(columnOptions).values({ userId: "local", columnId: sel, label: "x", color: "red", position: 0 }).returning().get().id;
    const cases = [
      [col("text"), "hi", "hi"], [col("number"), 3.5, 3.5], [col("date"), "2026-03-04", "2026-03-04"],
      [col("link"), "example.com", "https://example.com/"], [col("checkbox"), false, false], [sel, opt, opt],
    ] as const;
    for (const [c, raw, want] of cases) {
      expect(await setCellValue(appId, c, raw)).toEqual({ ok: true, value: want });
      expect(await getCellValue(appId, c)).toBe(want);
    }
    expect(rows()).toHaveLength(6);
  });

  it("returns an error and writes nothing for invalid input", async () => {
    const c = col("date");
    expect((await setCellValue(appId, c, "2026-02-30")).ok).toBe(false);
    expect(rows()).toHaveLength(0);
  });

  it("refuses text or a link over the cap and writes nothing; exactly the cap is fine", async () => {
    const t = col("text");
    expect(await setCellValue(appId, t, "x".repeat(10_001))).toEqual({ ok: false, error: "Text must be at most 10,000 characters." });
    expect(await setCellValue(appId, col("link"), `a.com/${"x".repeat(10_000)}`)).toEqual({ ok: false, error: "Link must be at most 10,000 characters." });
    expect(rows()).toHaveLength(0);
    expect((await setCellValue(appId, t, ` ${"x".repeat(10_000)} `)).ok).toBe(true); // the cap counts the trimmed text
  });

  it("overwrite replaces the value, leaves other typed fields null and bumps updatedAt", async () => {
    const c = col("number");
    await setCellValue(appId, c, 1);
    db.update(cellValues).set({ updatedAt: new Date(0) }).run();
    await setCellValue(appId, c, 2);
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ valueNumber: 2, valueText: null, valueDate: null, valueBool: null, valueOptionId: null });
    expect(r[0].updatedAt.getTime()).toBeGreaterThan(0);
  });

  it("blank removes the row", async () => {
    const c = col("text");
    await setCellValue(appId, c, "x");
    expect(await setCellValue(appId, c, "  ")).toEqual({ ok: true, value: null });
    expect(rows()).toHaveLength(0);
    expect(await getCellValue(appId, c)).toBeNull();
    expect(await setCellValue(appId, c, null)).toEqual({ ok: true, value: null });
  });

  it("rejects an option from another column, and a missing option", async () => {
    const a = col("single_select");
    const b = col("single_select");
    const foreign = db.insert(columnOptions).values({ userId: "local", columnId: b, label: "x", color: "red", position: 0 }).returning().get().id;
    expect((await setCellValue(appId, a, foreign)).ok).toBe(false);
    expect((await setCellValue(appId, a, 9999)).ok).toBe(false);
    expect(rows()).toHaveLength(0);
  });

  it("rejects a column from another track", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const c = col("text", { trackId: t2 });
    expect(await setCellValue(appId, c, "x")).toEqual({ ok: false, error: "Column not found." });
    expect(rows()).toHaveLength(0);
  });

  it("rejects another user's application, column or option in the same track", async () => {
    const theirApp = db.insert(applications).values({ userId: "other", trackId, title: "B" }).returning().get().id;
    const theirCol = col("text", { userId: "other" });
    const sel = col("single_select");
    const theirOpt = db.insert(columnOptions).values({ userId: "other", columnId: sel, label: "x", color: "red", position: 0 }).returning().get().id;
    expect(await setCellValue(theirApp, col("text"), "x")).toEqual({ ok: false, error: "Application not found." });
    expect(await setCellValue(appId, theirCol, "x")).toEqual({ ok: false, error: "Column not found." });
    expect(await setCellValue(appId, sel, theirOpt)).toEqual({ ok: false, error: "Choose a valid option." });
    expect(rows()).toHaveLength(0);
  });

  it("rejects another user's application or column in another track", async () => {
    const t2 = db.insert(tracks).values({ userId: "other", name: "X", position: 0 }).returning().get().id;
    const theirApp = db.insert(applications).values({ userId: "other", trackId: t2, title: "B" }).returning().get().id;
    const theirCol = col("text", { userId: "other", trackId: t2 });
    expect((await setCellValue(theirApp, col("text"), "x")).ok).toBe(false);
    expect((await setCellValue(appId, theirCol, "x")).ok).toBe(false);
    expect(rows()).toHaveLength(0);
  });

  it("does not read another user's cell", async () => {
    const c = col("text");
    await setCellValue(appId, c, "x");
    db.update(cellValues).set({ userId: "other" }).where(eq(cellValues.columnId, c)).run();
    expect(await getCellValue(appId, c)).toBeNull();
  });
});
