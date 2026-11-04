import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { addOption, updateOption } from "@/app/actions/options";
import { listApplicationRows } from "@/lib/db/applications";
import { listColumns } from "@/lib/db/columns";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { MAX_OPTION_LABEL } from "@/lib/options";
import { formatCell } from "@/lib/table";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let colId: number; // single_select with options Applied(blue, buffer 3), Offer(green)
let applied: number;
const snapshot = () => JSON.stringify([db.select().from(columnOptions).all(), db.select().from(cellValues).all()]);

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  colId = db.insert(columns).values({ userId: "local", trackId, name: "Status", type: "single_select", isStatus: true, position: 0 }).returning().get().id;
  const o = (label: string, color: string, position: number, bufferDays?: number) =>
    db.insert(columnOptions).values({ userId: "local", columnId: colId, label, color, position, bufferDays }).returning().get().id;
  applied = o("Applied", "blue", 0, 3);
  o("Offer", "green", 1);
});
afterEach(dropTestDb);

async function twelveRowsOn(optionId: number) {
  const ids = db.insert(applications).values(Array.from({ length: 12 }, (_, i) => ({ userId: "local", trackId, title: `App ${i}` }))).returning().all().map((a) => a.id);
  db.insert(cellValues).values(ids.map((applicationId) => ({ userId: "local", applicationId, columnId: colId, valueOptionId: optionId }))).run();
}

async function shown() {
  const col = (await listColumns(trackId))[0];
  const rows = await listApplicationRows(trackId);
  return { col, rows, ids: rows.map((r) => r.values[colId]), labels: rows.map((r) => formatCell(col, r.values[colId])) };
}

describe("AT-3: rename and recolour keep the value on every row", () => {
  it("rename: 12 rows still hold the option id and show the new label; buffer and position unchanged", async () => {
    await twelveRowsOn(applied);
    expect(await updateOption(colId, applied, { label: "  Sent  " })).toEqual({ ok: true });
    const s = await shown();
    expect(s.ids).toEqual(Array(12).fill(applied));
    expect(s.labels).toEqual(Array(12).fill("Sent"));
    expect(db.select().from(cellValues).all().filter((c) => c.valueOptionId === applied)).toHaveLength(12);
    const row = db.select().from(columnOptions).all().find((o) => o.id === applied)!;
    expect(row).toMatchObject({ label: "Sent", color: "blue", position: 0, bufferDays: 3 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("recolour: 12 rows still hold the option id and the option shows the new colour", async () => {
    await twelveRowsOn(applied);
    expect(await updateOption(colId, applied, { color: "purple" })).toEqual({ ok: true });
    const s = await shown();
    expect(s.ids).toEqual(Array(12).fill(applied));
    expect(s.col.options.find((o) => o.id === applied)).toMatchObject({ label: "Applied", color: "purple", position: 0 });
    expect(db.select().from(columnOptions).all().find((o) => o.id === applied)?.bufferDays).toBe(3);
  });

  it("allows changing only the case of its own label, and both fields at once", async () => {
    expect((await updateOption(colId, applied, { label: "APPLIED" })).ok).toBe(true);
    expect((await updateOption(colId, applied, { label: "x".repeat(MAX_OPTION_LABEL), color: "gray" })).ok).toBe(true);
  });
});

describe("addOption", () => {
  it("appends at the end with the next unused colour, trimmed", async () => {
    const r = await addOption(colId, "  Interview ");
    expect(r.ok).toBe(true);
    const opts = (await listColumns(trackId))[0].options;
    expect(opts.map((o) => o.label)).toEqual(["Applied", "Offer", "Interview"]);
    expect(opts[2]).toMatchObject({ color: "red", position: 2 }); // red is the first palette token not used (blue, green are)
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("rejections write nothing", () => {
  it("add", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const text = db.insert(columns).values({ userId: "local", trackId, name: "Company", type: "text", position: 1 }).returning().get().id;
    const before = snapshot();
    const cases: [unknown, unknown, string][] = [
      [colId, "applied", "An option with that label already exists."], // case-insensitive
      [colId, " OFFER ", "An option with that label already exists."],
      [colId, "", "Label is required."],
      [colId, "   ", "Label is required."],
      [colId, 5, "Label is required."],
      [colId, "x".repeat(MAX_OPTION_LABEL + 1), `Label must be at most ${MAX_OPTION_LABEL} characters.`],
      [foreign, "New", "Column not found."], // other user's column
      [9999, "New", "Column not found."],
      ["1", "New", "Column not found."],
      [text, "New", "Only single-select columns have options."],
    ];
    for (const [c, l, error] of cases) expect(await addOption(c as number, l as string), JSON.stringify([c, l])).toEqual({ ok: false, error });
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("update", async () => {
    await twelveRowsOn(applied);
    const otherCol = db.insert(columns).values({ userId: "local", trackId, name: "Stage", type: "single_select", position: 1 }).returning().get().id;
    const otherOpt = db.insert(columnOptions).values({ userId: "local", columnId: otherCol, label: "Z", color: "red", position: 0 }).returning().get().id;
    const other = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = db.insert(columns).values({ userId: "someone-else", trackId: other, name: "S", type: "single_select", position: 0 }).returning().get().id;
    const foreignOpt = db.insert(columnOptions).values({ userId: "someone-else", columnId: foreignCol, label: "F", color: "red", position: 0 }).returning().get().id;
    const text = db.insert(columns).values({ userId: "local", trackId, name: "Company", type: "text", position: 2 }).returning().get().id;
    const before = snapshot();
    const cases: [unknown, unknown, unknown, string][] = [
      [colId, applied, { label: "offer" }, "An option with that label already exists."],
      [colId, applied, { label: "" }, "Label is required."],
      [colId, applied, { label: "  " }, "Label is required."],
      [colId, applied, { label: 5 }, "Nothing to change."],
      [colId, applied, { label: "x".repeat(MAX_OPTION_LABEL + 1) }, `Label must be at most ${MAX_OPTION_LABEL} characters.`],
      [colId, applied, { color: "magenta" }, "Choose a valid colour."],
      [colId, applied, { color: "constructor" }, "Choose a valid colour."],
      [colId, applied, { color: "bg-red-100" }, "Choose a valid colour."],
      [colId, applied, { color: 3 }, "Nothing to change."],
      [colId, applied, {}, "Nothing to change."],
      [colId, applied, null, "Nothing to change."],
      [colId, applied, "red", "Nothing to change."],
      [colId, otherOpt, { label: "Hacked" }, "Option not found."], // option of another column
      [otherCol, applied, { label: "Hacked" }, "Option not found."],
      [colId, foreignOpt, { label: "Hacked" }, "Option not found."], // other user's option
      [foreignCol, foreignOpt, { label: "Hacked" }, "Column not found."],
      [colId, 9999, { label: "Hacked" }, "Option not found."],
      [colId, "1", { label: "Hacked" }, "Option not found."],
      [text, applied, { label: "Hacked" }, "Only single-select columns have options."],
    ];
    for (const [c, o, p, error] of cases) expect(await updateOption(c as number, o as number, p as never), JSON.stringify([c, o, p])).toEqual({ ok: false, error });
    expect(snapshot()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
    expect((await shown()).labels).toEqual(Array(12).fill("Applied"));
  });
});
