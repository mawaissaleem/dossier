import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { moveColumn, renameColumn, setColumnHidden } from "@/app/actions/columns";
import { listApplicationRows } from "@/lib/db/applications";
import { MAX_COLUMN_NAME, listColumns } from "@/lib/db/columns";
import { applications, cellValues, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let ids: number[]; // A, B, C, D in position order
const snapshot = () => JSON.stringify(db.select().from(columns).all());
const names = async () => (await listColumns(trackId)).map((c) => c.name).join("");
const positions = () => db.select().from(columns).all().filter((c) => c.trackId === trackId).map((c) => c.position).sort((a, b) => a - b);

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  ids = ["A", "B", "C", "D"].map((name, position) => db.insert(columns).values({ userId: "local", trackId, name, type: "text", position }).returning().get().id);
});
afterEach(dropTestDb);

describe("renameColumn", () => {
  it("renames, trims, and keeps the values", async () => {
    const app = db.insert(applications).values({ userId: "local", trackId, title: "T" }).returning().get().id;
    db.insert(cellValues).values({ userId: "local", applicationId: app, columnId: ids[0], valueText: "hello" }).run();
    expect(await renameColumn(trackId, ids[0], "  Company  ")).toEqual({ ok: true });
    expect((await listColumns(trackId))[0].name).toBe("Company");
    expect((await listApplicationRows(trackId))[0].values[ids[0]]).toBe("hello");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("allows changing only the case of its own name, and the max length", async () => {
    expect((await renameColumn(trackId, ids[0], "a")).ok).toBe(true);
    expect((await renameColumn(trackId, ids[0], "x".repeat(MAX_COLUMN_NAME))).ok).toBe(true);
  });

  it("rejects failures and writes nothing", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "Z", type: "text", position: 0 }).returning().get().id;
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const inT2 = db.insert(columns).values({ userId: "local", trackId: t2, name: "Y", type: "text", position: 0 }).returning().get().id;
    const before = snapshot();
    const cases: [unknown, unknown, unknown, string][] = [
      [trackId, ids[0], "b", "A column with that name already exists."], // case-insensitive
      [trackId, ids[0], " C ", "A column with that name already exists."],
      [trackId, ids[0], "", "Name is required."],
      [trackId, ids[0], "   ", "Name is required."],
      [trackId, ids[0], 5, "Name is required."],
      [trackId, ids[0], "x".repeat(MAX_COLUMN_NAME + 1), `Name must be at most ${MAX_COLUMN_NAME} characters.`],
      [other, foreign, "New", "Column not found."], // other user's column
      [trackId, foreign, "New", "Column not found."],
      [trackId, inT2, "New", "Column not found."], // column of another track
      [trackId, 9999, "New", "Column not found."],
      [trackId, "1", "New", "Column not found."],
      [0, ids[0], "New", "Column not found."],
    ];
    for (const [t, c, n, error] of cases) expect(await renameColumn(t as number, c as number, n as string)).toEqual({ ok: false, error });
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("setColumnHidden", () => {
  it("hides and shows, keeps position and values, and any column incl. status", async () => {
    expect(await setColumnHidden(trackId, ids[1], true)).toEqual({ ok: true });
    expect((await listColumns(trackId)).map((c) => [c.name, c.hidden])).toEqual([["A", false], ["B", true], ["C", false], ["D", false]]);
    expect(await setColumnHidden(trackId, ids[1], false)).toEqual({ ok: true });
    expect((await listColumns(trackId))[1]).toMatchObject({ name: "B", hidden: false });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("status column can be hidden", async () => {
    db.update(columns).set({ isStatus: true }).where(eq(columns.id, ids[0])).run();
    expect((await setColumnHidden(trackId, ids[0], true)).ok).toBe(true);
    expect((await listColumns(trackId))[0]).toMatchObject({ isStatus: true, hidden: true });
  });

  it("rejects bad args, other tracks and other users", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "Z", type: "text", position: 0 }).returning().get().id;
    const before = snapshot();
    for (const [t, c, h] of [[other, foreign, true], [trackId, foreign, true], [trackId, 9999, true], [trackId, ids[0], "yes"], [trackId, 0, true]] as const) {
      expect(await setColumnHidden(t, c, h as boolean)).toEqual({ ok: false, error: "Column not found." });
    }
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("moveColumn", () => {
  it("moves left and right and the order persists across reads", async () => {
    expect(await moveColumn(trackId, ids[2], "left")).toEqual({ ok: true });
    expect(await names()).toBe("ACBD");
    expect(await names()).toBe("ACBD");
    expect(await moveColumn(trackId, ids[0], "right")).toEqual({ ok: true });
    expect(await names()).toBe("CABD");
  });

  it("at an edge it is an ok no-op", async () => {
    expect(await moveColumn(trackId, ids[0], "left")).toEqual({ ok: true });
    expect(await moveColumn(trackId, ids[3], "right")).toEqual({ ok: true });
    expect(await names()).toBe("ABCD");
    expect(positions()).toEqual([0, 1, 2, 3]);
  });

  it("skips hidden columns: one step on screen, hidden ones keep their slot", async () => {
    await setColumnHidden(trackId, ids[1], true); // A [B] C D
    await moveColumn(trackId, ids[2], "left"); // C passes A, not B
    expect(await names()).toBe("CBAD"); // B stays between, A now after it
    const visible = (await listColumns(trackId)).filter((c) => !c.hidden).map((c) => c.name).join("");
    expect(visible).toBe("CAD");
    await moveColumn(trackId, ids[0], "left"); // A passes C
    expect((await listColumns(trackId)).filter((c) => !c.hidden).map((c) => c.name).join("")).toBe("ACD");
    expect(positions()).toEqual([0, 1, 2, 3]);
  });

  it("a column with only hidden neighbours on one side is a no-op that way", async () => {
    await setColumnHidden(trackId, ids[0], true);
    await moveColumn(trackId, ids[1], "left");
    expect(await names()).toBe("ABCD");
  });

  it("renumbers a gappy or duplicated position set to 0..n-1", async () => {
    db.update(columns).set({ position: 7 }).run();
    await moveColumn(trackId, ids[3], "left");
    expect(positions()).toEqual([0, 1, 2, 3]);
  });

  it("positions stay unique and gap-free after a mixed sequence", async () => {
    const extra = db.insert(columns).values({ userId: "local", trackId, name: "E", type: "text", position: 4 }).returning().get().id;
    await moveColumn(trackId, extra, "left");
    await setColumnHidden(trackId, ids[0], true);
    await moveColumn(trackId, ids[1], "right");
    await renameColumn(trackId, ids[2], "Cc");
    await moveColumn(trackId, ids[3], "left");
    await moveColumn(trackId, ids[0], "right"); // hidden column moves too
    await setColumnHidden(trackId, ids[0], false);
    await moveColumn(trackId, extra, "right");
    expect(positions()).toEqual([0, 1, 2, 3, 4]);
    expect(new Set((await listColumns(trackId)).map((c) => c.id)).size).toBe(5);
  });

  it("does not touch another track's columns", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    db.insert(columns).values({ userId: "local", trackId: t2, name: "P", type: "text", position: 0 }).run();
    await moveColumn(trackId, ids[1], "left");
    expect(db.select().from(columns).all().find((c) => c.trackId === t2)?.position).toBe(0);
  });

  it("rejects bad args, other tracks and other users", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "Z", type: "text", position: 0 }).returning().get().id;
    const before = snapshot();
    for (const [t, c, d] of [[other, foreign, "left"], [trackId, foreign, "left"], [trackId, 9999, "right"], [trackId, ids[1], "up"], [trackId, 1.5, "left"]] as const) {
      expect(await moveColumn(t, c, d as "left")).toEqual({ ok: false, error: "Column not found." });
    }
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });
});
