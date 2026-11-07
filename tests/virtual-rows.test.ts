import { describe, expect, it } from "vitest";
import { CELL_PADDING_X, COLUMN_WIDTH, columnWidth, EDITOR_MIN_WIDTH, spacers, withPinned } from "@/lib/virtual-rows";
import { editorKind } from "@/lib/table";
import type { ColumnType } from "@/lib/db/schema";

describe("withPinned", () => {
  it("adds the pinned rows to the window, sorted and without duplicates", () => {
    expect(withPinned([10, 11, 12], [500, 11, 2], 1000)).toEqual([2, 10, 11, 12, 500]);
  });
  it("drops pinned indexes that are out of range (a filtered-out row)", () => {
    expect(withPinned([0, 1], [-1, 5, 6], 5)).toEqual([0, 1]);
  });
  it("is the window itself when nothing is pinned", () => {
    expect(withPinned([3, 4, 5], [], 100)).toEqual([3, 4, 5]);
  });
});

describe("spacers", () => {
  const item = (index: number) => ({ index, start: 36 + index * 41, end: 36 + (index + 1) * 41 });
  it("fills above and below one contiguous window", () => {
    // 100 rows of 41px, window = rows 10..12, header margin 36
    expect(spacers([item(10), item(11), item(12)], 4100, 36)).toEqual({ before: [410, 0, 0], after: (100 - 13) * 41 });
  });
  it("leaves a gap in the middle for a pinned row far from the window", () => {
    expect(spacers([item(2), item(90), item(91)], 4100, 36)).toEqual({ before: [82, 87 * 41, 0], after: 8 * 41 });
  });
  it("is one spacer of the whole height when nothing is mounted", () => {
    expect(spacers([], 4100, 36)).toEqual({ before: [], after: 4100 });
  });
  it("never goes negative", () => {
    expect(spacers([{ index: 0, start: 0, end: 50 }], 10, 36).after).toBe(0);
  });
});

describe("columnWidth", () => {
  it("has a width for every column type", () => {
    const types: ColumnType[] = ["text", "number", "date", "link", "checkbox", "single_select"];
    for (const t of types) expect(columnWidth(t)).toBeGreaterThanOrEqual(100);
    expect(Object.keys(COLUMN_WIDTH)).toEqual(expect.arrayContaining(types));
  });
  it("fits the inline editor inside every editable column (width minus cell padding)", () => {
    const editable = (Object.keys(COLUMN_WIDTH) as ColumnType[]).filter((t) => editorKind(t));
    expect(editable.length).toBeGreaterThan(0);
    for (const t of editable) expect(columnWidth(t) - CELL_PADDING_X, t).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);
  });
});
