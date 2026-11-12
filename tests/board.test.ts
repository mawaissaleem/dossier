import { describe, expect, it } from "vitest";
import type { ApplicationRow } from "@/lib/db/applications";
import { closestCenter, type CollisionDetection } from "@dnd-kit/core";
import { applyMove, boardGroups, columnAtX, columnFilteredOut, columnLabel, groupByStatus, hiddenAfterMove, nextColumn, planMove } from "@/lib/board";
import type { Filter } from "@/lib/filter";

const status = { id: 1, options: [
  { id: 30, label: "Zed", color: "blue", position: 0 },
  { id: 10, label: "Alpha", color: "red", position: 1 },
  { id: 20, label: "Mid", color: "green", position: 2 },
] };
const row = (id: number, v: ApplicationRow["values"][number]): ApplicationRow => ({ id, title: `t${id}`, values: { 1: v } });
const ids = (c: { cards: ApplicationRow[] }) => c.cards.map((r) => r.id);

describe("groupByStatus", () => {
  it("one column per option in option order, even with no rows", () => {
    const g = groupByStatus([], status);
    expect(g.map((c) => c.label)).toEqual(["Zed", "Alpha", "Mid"]);
    expect(g.map((c) => c.color)).toEqual(["blue", "red", "green"]);
    expect(g.every((c) => c.cards.length === 0)).toBe(true);
  });
  it("groups cards by option, newest first whatever the input order", () => {
    const g = groupByStatus([row(1, 10), row(5, 30), row(3, 10), row(4, 20), row(2, 10)], status);
    expect(ids(g[0])).toEqual([5]);
    expect(ids(g[1])).toEqual([3, 2, 1]);
    expect(ids(g[2])).toEqual([4]);
  });
  it("blank, missing and deleted-option values go to a last No status column", () => {
    const g = groupByStatus([row(1, null), row(2, 999), row(3, "x"), row(4, 10), { id: 5, title: "t5", values: {} }], status);
    expect(g.map((c) => c.label)).toEqual(["Zed", "Alpha", "Mid", "No status"]);
    expect(ids(g[3])).toEqual([5, 3, 2, 1]);
    expect(g[3].optionId).toBeNull();
  });
  it("leaves No status out when nothing is blank; no options means only No status", () => {
    expect(groupByStatus([row(1, 10)], status)).toHaveLength(3);
    expect(groupByStatus([row(1, null)], { id: 1, options: [] }).map((c) => c.label)).toEqual(["No status"]);
    expect(groupByStatus([], { id: 1, options: [] })).toEqual([]);
  });
  it("does not mutate its input", () => {
    const rows = [row(1, 10), row(2, 10)];
    groupByStatus(rows, status);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

// 9.4 / FR-4.3: the board filters with the table's filterRows, then groups. Status is column 1 (single-select, options 30 / 10 / 20); Priority is column 2.
describe("boardGroups (filter, then group) and columnFilteredOut", () => {
  const sel = [
    { id: 1, type: "single_select" as const, options: status.options },
    { id: 2, type: "single_select" as const, options: [{ id: 50, label: "High", color: "red", position: 0 }, { id: 51, label: "Low", color: "gray", position: 1 }] },
  ];
  const r = (id: number, s: number | null, p: number | null): ApplicationRow => ({ id, title: `t${id}`, values: { 1: s, 2: p } });
  const rs = [r(1, 10, 50), r(2, 10, 51), r(3, 20, 50), r(4, null, 50), r(5, 999, 51), r(6, 30, 50)];
  const f = (id: number, options: number[], blank = false): Filter => ({ id, options, blank });
  const counts = (g: ReturnType<typeof boardGroups>) => g.map((c) => [c.label, ids(c)]);

  it("with no filters it is groupByStatus of every row (AT-1: a title-only row shows under No status)", () => {
    expect(boardGroups(rs, sel, [], status)).toEqual(groupByStatus(rs, status));
    const titleOnly = [{ id: 9, title: "only a title", values: {} }];
    expect(counts(boardGroups(titleOnly, sel, [], status)).at(-1)).toEqual(["No status", [9]]);
  });
  it("a non-status filter removes cards but keeps every status column", () => {
    expect(counts(boardGroups(rs, sel, [f(2, [50])], status))).toEqual([["Zed", [6]], ["Alpha", [1]], ["Mid", [3]], ["No status", [4]]]);
  });
  it("a status filter leaves the other columns empty; options and blank are OR, columns AND", () => {
    expect(counts(boardGroups(rs, sel, [f(1, [10])], status))).toEqual([["Zed", []], ["Alpha", [2, 1]], ["Mid", []]]);
    expect(counts(boardGroups(rs, sel, [f(1, [10], true)], status))).toEqual([["Zed", []], ["Alpha", [2, 1]], ["Mid", []], ["No status", [5, 4]]]); // blank: no value or deleted option
    expect(counts(boardGroups(rs, sel, [f(1, [10], true), f(2, [51])], status))).toEqual([["Zed", []], ["Alpha", [2]], ["Mid", []], ["No status", [5]]]);
  });
  it("a blank-only status filter shows only No status; filters that match nothing leave empty columns", () => {
    expect(counts(boardGroups(rs, sel, [f(1, [], true)], status))).toEqual([["Zed", []], ["Alpha", []], ["Mid", []], ["No status", [5, 4]]]);
    expect(boardGroups(rs, sel, [f(1, [20]), f(2, [51])], status).every((c) => c.cards.length === 0)).toBe(true);
  });
  it("does not mutate the rows and ignores a filter on a column that is not a select", () => {
    const copy = [...rs];
    boardGroups(rs, sel, [f(2, [50])], status);
    expect(rs).toEqual(copy);
    expect(boardGroups(rs, sel, [f(77, [1])], status)).toEqual(groupByStatus(rs, status));
  });
  it("columnFilteredOut: only a status filter leaves a column out", () => {
    expect(columnFilteredOut([], 1, 10)).toBe(false);
    expect(columnFilteredOut([f(2, [50])], 1, 10)).toBe(false); // another column's filter
    expect(columnFilteredOut([f(1, [10])], 1, 10)).toBe(false);
    expect(columnFilteredOut([f(1, [10])], 1, 20)).toBe(true);
    expect(columnFilteredOut([f(1, [10])], 1, null)).toBe(true);
    expect(columnFilteredOut([f(1, [], true)], 1, null)).toBe(false);
  });
  it("hiddenAfterMove: true when the status filter excludes the target, false when it keeps the card", () => {
    const m = planMove(groupByStatus(rs, status), 1, 1, 20)!;
    expect(hiddenAfterMove(rs[0], sel, [f(1, [10])], 1, m)).toBe(true);
    expect(hiddenAfterMove(rs[0], sel, [f(1, [10, 20])], 1, m)).toBe(false);
    expect(hiddenAfterMove(rs[0], sel, [f(2, [51])], 1, m)).toBe(true); // already hidden by priority: unchanged by the move
    expect(hiddenAfterMove(rs[0], sel, [], 1, m)).toBe(false);
    expect(hiddenAfterMove(rs[0], sel, [f(1, [], true)], 1, planMove(groupByStatus(rs, status), 1, 1, null)!)).toBe(false); // moved to No status, blank kept
  });
});

describe("columnLabel", () => {
  it("pluralises", () => {
    expect(columnLabel("Applied", 12)).toBe("Applied, 12 applications");
    expect(columnLabel("Applied", 1)).toBe("Applied, 1 application");
    expect(columnLabel("Applied", 0)).toBe("Applied, 0 applications");
  });
});

describe("planMove and applyMove (board drop, optimistic state)", () => {
  const rows = [row(1, 10), row(2, 999), row(3, null)];
  const groups = groupByStatus(rows, status);
  it("plans a move into another column and carries the raw old value", () => {
    expect(planMove(groups, 1, 1, 20)).toEqual({ rowId: 1, from: 10, to: 20 });
    expect(planMove(groups, 1, 2, 20)).toEqual({ rowId: 2, from: 999, to: 20 }); // deleted option: shown under No status
    expect(planMove(groups, 1, 1, null)).toEqual({ rowId: 1, from: 10, to: null }); // No status clears the status
  });
  it("plans nothing for the same column, an unknown card or an unknown option", () => {
    expect(planMove(groups, 1, 1, 10)).toBeNull();
    expect(planMove(groups, 1, 2, null)).toBeNull(); // already under No status
    expect(planMove(groups, 1, 99, 20)).toBeNull();
    expect(planMove(groups, 1, 1, 12345)).toBeNull();
  });
  it("applies the move to its card only, without mutating, and rolls back by dropping it", () => {
    const m = planMove(groups, 1, 1, 20)!;
    const moved = applyMove(rows, 1, m);
    expect(moved.map((r) => r.values[1])).toEqual([20, 999, null]);
    expect(rows[0].values[1]).toBe(10);
    expect(applyMove(rows, 1, null)).toBe(rows);
    expect(ids(groupByStatus(moved, status)[2])).toEqual([1]);
  });
  it("switches itself off once the row no longer has the status it started from", () => {
    const m = planMove(groups, 1, 1, 20)!;
    expect(applyMove([row(1, 20)], 1, m)[0].values[1]).toBe(20); // refreshed: the saved value
    expect(applyMove([row(1, 30)], 1, m)[0].values[1]).toBe(30); // changed elsewhere meanwhile: not overridden
    expect(applyMove([{ id: 1, title: "t1", values: {} }], 1, planMove(groupByStatus([{ id: 1, title: "t1", values: {} }], status), 1, 1, 10)!)[0].values[1]).toBe(10);
  });
});

// Keyboard drag geometry with the board's real sizes: 288px columns (w-72), a 12px gap, a 264x70 card placed 8px below a column's top.
describe("columnAtX and nextColumn (keyboard drag)", () => {
  const W = 288, CARD = 264;
  const col = (i: number, height: number) => ({ id: `c${i}`, left: i * (W + 12), width: W, top: 100, height });
  // Where the keyboard getter puts the card in column t, and the card's centre x the collision check uses.
  const placed = (t: { left: number; width: number; top: number }) => ({ left: t.left + (t.width - CARD) / 2, top: t.top + 8, width: CARD, height: 70 });
  const mid = (r: { left: number; width: number }) => r.left + r.width / 2;
  // dnd-kit's closestCenter, the detection used before: card centre to column centre, height included.
  const closest = (r: ReturnType<typeof placed>, cols: ReturnType<typeof col>[]) =>
    closestCenter({ collisionRect: r, droppableContainers: cols, droppableRects: new Map(cols.map((c) => [c.id, c])) } as unknown as Parameters<CollisionDetection>[0])[0];

  it("ArrowRight into a tall column next to a short one lands on the tall column", () => {
    const cols = [col(0, 200), col(1, 975), col(2, 90)];
    const t = nextColumn(mid(placed(cols[0])), 1, cols)!;
    expect(t.id).toBe("c1");
    expect(columnAtX(mid(placed(t)), cols)!.id).toBe("c1");
    expect(closest(placed(t), cols).id).toBe("c2"); // the bug this replaces
  });
  it("ArrowLeft into a tall column next to a short one lands on the tall column", () => {
    const cols = [col(0, 90), col(1, 975), col(2, 200)];
    const t = nextColumn(mid(placed(cols[2])), -1, cols)!;
    expect(t.id).toBe("c1");
    expect(columnAtX(mid(placed(t)), cols)!.id).toBe("c1");
    expect(closest(placed(t), cols).id).toBe("c0");
  });
  it("picking up and dropping the top card of a tall column keeps it in its own column", () => {
    const cols = [col(0, 800), col(1, 90)];
    const card = { left: cols[0].left + 12, top: cols[0].top + 49, width: CARD, height: 70 }; // first card under the header
    expect(columnAtX(mid(card), cols)!.id).toBe("c0");
    expect(closest(card, cols).id).toBe("c1");
  });
  it("equal-height columns, the edges and the gap", () => {
    const cols = [col(0, 300), col(1, 300), col(2, 300)];
    expect(nextColumn(mid(placed(cols[1])), 1, cols)!.id).toBe("c2");
    expect(nextColumn(mid(placed(cols[1])), -1, cols)!.id).toBe("c0");
    expect(nextColumn(mid(placed(cols[2])), 1, cols)).toBeUndefined();
    expect(nextColumn(mid(placed(cols[0])), -1, cols)).toBeUndefined();
    expect(columnAtX(mid(placed(cols[2])), cols)!.id).toBe("c2");
    expect(columnAtX(W + 4, cols)!.id).toBe("c0"); // in the 12px gap, nearer the left column
    expect(columnAtX(W + 9, cols)!.id).toBe("c1");
    expect(columnAtX(5, [])).toBeUndefined();
  });
  it("a card shifted left by its list's scrollbar still moves one column per arrow", () => {
    // Measured in Firefox: a 258px card at col.left + 9 (1px border + 8px padding) beside a 12px scrollbar, so its centre is 6px left of the column's.
    const cols = [col(0, 900), col(1, 900), col(2, 900)];
    const shifted = (c: (typeof cols)[number]) => c.left + 9 + 258 / 2;
    expect(nextColumn(shifted(cols[0]), 1, cols)!.id).toBe("c1");
    expect(nextColumn(shifted(cols[1]), 1, cols)!.id).toBe("c2");
    expect(nextColumn(shifted(cols[1]), -1, cols)!.id).toBe("c0");
    expect(nextColumn(shifted(cols[2]), 1, cols)).toBeUndefined();
    expect(nextColumn(W + 6, 1, cols)!.id).toBe("c1"); // a centre in the gap still reaches the next column
  });
});
