import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplication } from "@/app/actions/applications";
import { addColumn } from "@/app/actions/columns";
import { buildCreateValues, splitEssentials } from "@/lib/application-form";
import { boardGroups } from "@/lib/board";
import { listApplicationRows } from "@/lib/db/applications";
import { listColumns } from "@/lib/db/columns";
import { listTracks } from "@/lib/db/tracks";
import { formatCell } from "@/lib/table";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

// Task 12.3: AT-1 and AT-2 as the SRS words them, on the real seeded Job track, through the same calls the track page and the add form make.
// (The pieces are also tested one by one in create-defaults, board and columns-action; these two encode the whole sentence.)
let trackId: number;

beforeEach(async () => {
  useTestDb();
  runSeed();
  trackId = (await listTracks()).find((t) => t.name === "Job")!.id;
});
afterEach(dropTestDb);

describe("AT-1: add an application with only a title", () => {
  it("saves, and appears in the table rows and on the board", async () => {
    const cols = await listColumns(trackId);
    const r = await createApplication("Only a title", trackId, buildCreateValues(cols, {})); // what the form sends with nothing else typed
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = await listApplicationRows(trackId, cols); // the table's source
    expect(rows.map((x) => x.title)).toEqual(["Only a title"]);
    const status = cols.find((c) => c.isStatus)!;
    const selects = cols.filter((c) => c.type === "single_select");
    const board = boardGroups(rows, selects, [], status); // the board's source
    const holders = board.filter((c) => c.cards.some((card) => card.id === r.id));
    expect(holders).toHaveLength(1);
    expect(holders[0].label).toBe("To apply"); // the track's default status
    // every other column is blank
    for (const c of cols.filter((c) => !c.isStatus)) expect(rows[0].values[c.id] ?? null, c.name).toBeNull();
  });
});

describe("AT-2: with 50 applications present, add a column", () => {
  it("all 50 show it as empty and the add form includes it", async () => {
    const cols = await listColumns(trackId);
    for (let i = 1; i <= 50; i++) expect((await createApplication(`App ${i}`, trackId, buildCreateValues(cols, {}))).ok).toBe(true);
    expect(await listApplicationRows(trackId)).toHaveLength(50);

    const added = await addColumn(trackId, "Contact person", "text");
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const after = await listColumns(trackId); // what the track page now hands to the table and to the add form
    const col = after.find((c) => c.id === added.id)!;
    const rows = await listApplicationRows(trackId, after);
    expect(rows).toHaveLength(50);
    expect(rows.every((x) => formatCell(col, x.values[col.id] ?? null) === "")).toBe(true); // shown empty on every row
    // add form: the field is rendered (essentials + rest cover every column) and a title-only submit sends it (blank)
    const { essentials, rest } = splitEssentials(after);
    expect([...essentials, ...rest].map((c) => c.id)).toContain(col.id);
    expect(buildCreateValues(after, {}).find((v) => v.columnId === col.id)).toEqual({ columnId: col.id, value: null });
  });
});
