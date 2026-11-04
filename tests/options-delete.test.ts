import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { deleteOption, fetchOptionDeleteImpact } from "@/app/actions/options";
import { listApplicationRows } from "@/lib/db/applications";
import { listColumns } from "@/lib/db/columns";
import { isForeignKeyViolation } from "@/lib/db/errors";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let colId: number; // Stage (single_select): X(0) Y(1) Z(2); default = X
let x: number, y: number, z: number;
let appIds: number[]; // 12 applications on X; the last one is archived
const snapshot = () => JSON.stringify([db.select().from(columnOptions).all(), db.select().from(cellValues).all(), db.select().from(columns).all()]);
const opt = (columnId: number, label: string, position: number, userId = "local") =>
  db.insert(columnOptions).values({ userId, columnId, label, color: "blue", position }).returning().get().id;

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  colId = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 0 }).returning().get().id;
  x = opt(colId, "X", 0);
  y = opt(colId, "Y", 1);
  z = opt(colId, "Z", 2);
  db.update(columns).set({ defaultValue: String(x) }).where(eq(columns.id, colId)).run();
  appIds = db.insert(applications).values(Array.from({ length: 12 }, (_, i) => ({ userId: "local", trackId, title: `App ${i}`, archived: i === 11 }))).returning().all().map((a) => a.id);
  db.insert(cellValues).values(appIds.map((applicationId) => ({ userId: "local", applicationId, columnId: colId, valueOptionId: x }))).run();
});
afterEach(dropTestDb);

const values = async () => (await listApplicationRows(trackId)).map((r) => r.values[colId]);
const optionIds = () => db.select().from(columnOptions).where(eq(columnOptions.columnId, colId)).all().map((o) => o.id);
const defaultValue = () => db.select().from(columns).where(eq(columns.id, colId)).get()!.defaultValue;

describe("fetchOptionDeleteImpact", () => {
  it("counts the rows using the option, archived included and reported, fresh each call", async () => {
    expect(await fetchOptionDeleteImpact(x)).toEqual({ ok: true, label: "X", useCount: 12, archivedCount: 1 });
    expect(await fetchOptionDeleteImpact(y)).toEqual({ ok: true, label: "Y", useCount: 0, archivedCount: 0 });
    db.delete(cellValues).where(eq(cellValues.applicationId, appIds[0])).run();
    expect((await fetchOptionDeleteImpact(x) as { useCount: number }).useCount).toBe(11);
  });

  it("rejects missing, malformed and other users' options", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const foreign = opt(foreignCol, "F", 0, "someone-else");
    for (const id of [foreign, 9999, "1", -1, 1.5]) expect(await fetchOptionDeleteImpact(id as number), String(id)).toEqual({ ok: false, error: "Option not found." });
  });
});

describe("AT-4: delete an option used by 12 rows", () => {
  it("without confirm (or with a malformed choice) is rejected and nothing changes", async () => {
    const before = snapshot();
    const cases: unknown[] = [undefined, null, {}, { confirm: false, reassignTo: y }, { confirm: "true", reassignTo: y }, { confirm: 1, reassignTo: null }];
    for (const c of cases) expect(await deleteOption(x, c as never), JSON.stringify(c)).toEqual({ ok: false, error: "Deleting must be confirmed." });
    for (const reassignTo of [undefined, "2", 0, -1, 1.5, NaN]) {
      expect((await deleteOption(x, { confirm: true, reassignTo, expectedUseCount: 12 } as never)).ok, String(reassignTo)).toBe(false);
    }
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reassign to Y: 12 rows now Y, X gone, positions closed up, default follows to Y", async () => {
    expect(await deleteOption(x, { confirm: true, reassignTo: y, expectedUseCount: 12 })).toEqual({ ok: true });
    expect(await values()).toEqual(Array(11).fill(y)); // the list hides the archived row; the count below includes it
    expect(db.select().from(cellValues).all().filter((c) => c.valueOptionId === y)).toHaveLength(12);
    expect(optionIds().sort()).toEqual([y, z].sort());
    expect((await listColumns(trackId))[0].options.map((o) => [o.label, o.position])).toEqual([["Y", 0], ["Z", 1]]);
    expect(defaultValue()).toBe(String(y));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leave blank: 12 rows blank (no cell rows left), X gone, application rows kept, default cleared", async () => {
    expect(await deleteOption(x, { confirm: true, reassignTo: null, expectedUseCount: 12 })).toEqual({ ok: true });
    expect(await values()).toEqual(Array(11).fill(null));
    expect(db.select().from(cellValues).all()).toHaveLength(0);
    expect(db.select().from(applications).all()).toHaveLength(12);
    expect(optionIds().sort()).toEqual([y, z].sort());
    expect(defaultValue()).toBeNull();
  });

  it("an unused option deletes with no cell changes and leaves another default alone", async () => {
    expect(await deleteOption(z, { confirm: true, reassignTo: null, expectedUseCount: 0 })).toEqual({ ok: true });
    expect(db.select().from(cellValues).all()).toHaveLength(12);
    expect(defaultValue()).toBe(String(x));
    expect((await listColumns(trackId))[0].options.map((o) => o.label)).toEqual(["X", "Y"]);
  });

  it("reassigning to another column's option, to X itself, or to a foreign/missing id is rejected and writes nothing", async () => {
    const otherCol = db.insert(columns).values({ userId: "local", trackId, name: "Other", type: "single_select", position: 1 }).returning().get().id;
    const otherOpt = opt(otherCol, "O", 0);
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const foreign = opt(foreignCol, "F", 0, "someone-else");
    const before = snapshot();
    for (const reassignTo of [otherOpt, x, foreign, 9999]) {
      expect(await deleteOption(x, { confirm: true, reassignTo, expectedUseCount: 12 }), String(reassignTo)).toEqual({ ok: false, error: "Choose another option of this column to reassign to." });
    }
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("another user's or missing option is rejected and writes nothing", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const foreign = opt(foreignCol, "F", 0, "someone-else");
    const before = snapshot();
    for (const id of [foreign, 9999, "1"]) expect(await deleteOption(id as number, { confirm: true, reassignTo: null, expectedUseCount: 0 }), String(id)).toEqual({ ok: false, error: "Option not found." });
    expect(snapshot()).toBe(before);
  });
});

describe("stale use count (FR-3.4: values added while the dialog was open are never wiped)", () => {
  const STALE = { ok: false, error: "The number of applications using this option changed. Check again." };

  it("expected 0, then 3 rows are set to the option: blank delete is refused and the option and the 3 values remain", async () => {
    expect((await fetchOptionDeleteImpact(z) as { useCount: number }).useCount).toBe(0); // the dialog opens
    db.update(cellValues).set({ valueOptionId: z }).where(inArray(cellValues.applicationId, appIds.slice(0, 3))).run(); // another tab
    const before = snapshot();
    expect(await deleteOption(z, { confirm: true, reassignTo: null, expectedUseCount: 0 })).toEqual(STALE);
    expect(snapshot()).toBe(before);
    expect(db.select().from(cellValues).all().filter((c) => c.valueOptionId === z)).toHaveLength(3);
    expect(refresh).not.toHaveBeenCalled();
    // After re-fetching, the fresh count is accepted.
    expect((await fetchOptionDeleteImpact(z) as { useCount: number }).useCount).toBe(3);
    expect(await deleteOption(z, { confirm: true, reassignTo: y, expectedUseCount: 3 })).toEqual({ ok: true });
    expect(db.select().from(cellValues).all().filter((c) => c.valueOptionId === y)).toHaveLength(3);
  });

  it("expected 12 but 13 now hold it: both blank and reassign are refused and nothing changes", async () => {
    const extra = db.insert(applications).values({ userId: "local", trackId, title: "App 12" }).returning().get().id;
    db.insert(cellValues).values({ userId: "local", applicationId: extra, columnId: colId, valueOptionId: x }).run();
    const before = snapshot();
    for (const reassignTo of [null, y]) expect(await deleteOption(x, { confirm: true, reassignTo, expectedUseCount: 12 }), String(reassignTo)).toEqual(STALE);
    expect(await deleteOption(x, { confirm: true, reassignTo: null, expectedUseCount: 14 })).toEqual(STALE); // fewer than shown is refused too
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a missing or invalid expectedUseCount is rejected and writes nothing", async () => {
    const before = snapshot();
    for (const expectedUseCount of [undefined, null, -1, 1.5, "0", "12", NaN, Infinity, 2 ** 53]) {
      expect(await deleteOption(x, { confirm: true, reassignTo: null, expectedUseCount } as never), String(expectedUseCount)).toEqual({ ok: false, error: "Deleting must be confirmed." });
    }
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("count and delete use the same column filter: a stray cell in another column is neither counted nor wiped (the FK blocks)", async () => {
    const otherCol = db.insert(columns).values({ userId: "local", trackId, name: "Other", type: "single_select", position: 1 }).returning().get().id;
    // Not reachable through the app (set-cell checks the column), written directly to prove count and delete use one filter.
    db.insert(cellValues).values({ userId: "local", applicationId: appIds[0], columnId: otherCol, valueOptionId: z }).run();
    expect((await fetchOptionDeleteImpact(z) as { useCount: number }).useCount).toBe(0);
    expect(await deleteOption(z, { confirm: true, reassignTo: null, expectedUseCount: 0 })).toEqual({ ok: false, error: "Applications still use this option. Reassign them or leave them blank first." });
    expect(optionIds()).toContain(z);
    expect(db.select().from(cellValues).where(eq(cellValues.columnId, otherCol)).all()).toHaveLength(1);
  });
});

describe("Status column", () => {
  it("refuses to delete its last option, keeps the default, but allows deleting others", async () => {
    db.update(columns).set({ isStatus: true }).where(eq(columns.id, colId)).run();
    expect((await deleteOption(y, { confirm: true, reassignTo: null, expectedUseCount: 0 })).ok).toBe(true);
    expect((await deleteOption(z, { confirm: true, reassignTo: x, expectedUseCount: 0 })).ok).toBe(true);
    const before = snapshot();
    expect(await deleteOption(x, { confirm: true, reassignTo: null, expectedUseCount: 12 })).toEqual({ ok: false, error: "The Status column needs at least one option." });
    expect(snapshot()).toBe(before);
    expect(defaultValue()).toBe(String(x));
  });

  it("a non-status column may lose its last option", async () => {
    for (const id of [y, z]) await deleteOption(id, { confirm: true, reassignTo: null, expectedUseCount: 0 });
    expect((await deleteOption(x, { confirm: true, reassignTo: null, expectedUseCount: 12 })).ok).toBe(true);
    expect(optionIds()).toEqual([]);
  });
});

describe("foreign key safety net", () => {
  it("the FK still blocks removing an in-use option directly, and the helper recognises the error", () => {
    let caught: unknown;
    try {
      db.delete(columnOptions).where(eq(columnOptions.id, x)).run();
    } catch (e) {
      caught = e;
    }
    expect(isForeignKeyViolation(caught)).toBe(true);
    expect(optionIds()).toContain(x);
  });
});
