import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { addColumn } from "@/app/actions/columns";
import { listApplicationRows } from "@/lib/db/applications";
import { MAX_COLUMN_NAME, listColumns } from "@/lib/db/columns";
import { applications, cellValues, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

// refresh() only works inside a real Server Action request.
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
const snapshot = () => JSON.stringify([db.select().from(columns).all(), db.select().from(cellValues).all()]);

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  db.insert(columns).values({ userId: "local", trackId, name: "Company", type: "text", position: 0 }).run();
});
afterEach(dropTestDb);

describe("addColumn", () => {
  it("AT-2: with 50 applications, the new column is last and blank on every row, and no cell rows are written", async () => {
    db.insert(applications).values(Array.from({ length: 50 }, (_, i) => ({ userId: "local", trackId, title: `App ${i}` }))).run();
    const r = await addColumn(trackId, "  Salary  ", "number");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cols = await listColumns(trackId);
    expect(cols.at(-1)).toMatchObject({ id: r.id, name: "Salary", type: "number", hidden: false, isStatus: false, options: [] });
    const rows = await listApplicationRows(trackId);
    expect(rows).toHaveLength(50);
    expect(rows.every((row) => r.id in row.values && row.values[r.id] === null)).toBe(true);
    expect(db.select().from(cellValues).all()).toHaveLength(0);
    expect(db.select().from(columns).all().find((c) => c.id === r.id)?.defaultValue).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("appends after the last position, one step each time, for every type incl. single_select with no options", async () => {
    const ids: number[] = [];
    for (const [i, type] of (["text", "number", "date", "link", "checkbox", "single_select"] as const).entries()) {
      const r = await addColumn(trackId, `C${i}`, type);
      if (r.ok) ids.push(r.id);
    }
    expect(ids).toHaveLength(6);
    const cols = await listColumns(trackId);
    expect(cols.map((c) => c.id)).toEqual([expect.any(Number), ...ids]);
    expect(cols.at(-1)).toMatchObject({ type: "single_select", options: [] });
    expect(db.select().from(columns).all().map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("first column of an empty track gets position 0", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const r = await addColumn(t2, "A", "text");
    expect(r.ok).toBe(true);
    expect(db.select().from(columns).all().find((c) => c.trackId === t2)?.position).toBe(0);
  });

  it("same name in another track is allowed", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    expect((await addColumn(t2, "Company", "text")).ok).toBe(true);
  });

  it("rejects failures and writes nothing", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const before = snapshot();
    const cases: [unknown, unknown, unknown, string][] = [
      [trackId, "company", "text", "A column with that name already exists."], // different case
      [trackId, "  COMPANY ", "text", "A column with that name already exists."],
      [trackId, "", "text", "Name is required."],
      [trackId, "   ", "text", "Name is required."],
      [trackId, "x".repeat(MAX_COLUMN_NAME + 1), "text", `Name must be at most ${MAX_COLUMN_NAME} characters.`],
      [trackId, "Ok", "bogus", "Choose a valid type."],
      [trackId, "Ok", 5, "Choose a valid type."],
      [trackId, 5, "text", "Name is required."],
      [other, "Ok", "text", "Track not found."], // another user's track
      [9999, "Ok", "text", "Track not found."],
      ["1", "Ok", "text", "Track not found."],
      [0, "Ok", "text", "Track not found."],
      [1.5, "Ok", "text", "Track not found."],
    ];
    for (const [t, n, ty, error] of cases) {
      expect(await addColumn(t as number, n as string, ty as "text")).toEqual({ ok: false, error });
    }
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("accepts a name of exactly the max length", async () => {
    expect((await addColumn(trackId, "x".repeat(MAX_COLUMN_NAME), "text")).ok).toBe(true);
  });

  it("the DB unique error carries the code the data layer relies on", () => {
    let err: unknown;
    try {
      db.insert(columns).values({ userId: "local", trackId, name: "Company", type: "text", position: 9 }).run();
    } catch (e) {
      err = e;
    }
    const e = err as { code?: string; cause?: { code?: string } };
    expect((e.cause ?? e).code).toBe("SQLITE_CONSTRAINT_UNIQUE");
  });
});
