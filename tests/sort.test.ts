import { describe, expect, it } from "vitest";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { nextSort, parseSort, sortRows, withSort } from "@/lib/sort";

const col = (id: number, type: ColumnItem["type"], over: Partial<ColumnItem> = {}): ColumnItem => ({
  id, name: `c${id}`, type, hidden: false, isStatus: false, defaultValue: null, options: [], ...over,
});
const row = (id: number, v: ApplicationRow["values"][number], title = `t${id}`): ApplicationRow => ({ id, title, values: { 1: v } });
const ids = (rs: ApplicationRow[]) => rs.map((r) => r.id);
const run = (c: ColumnItem, vals: ApplicationRow["values"][number][], dir: "asc" | "desc") =>
  ids(sortRows(vals.map((v, i) => row(i + 1, v)), [c], { id: "col-1", dir }));

describe("sortRows", () => {
  it("text and link: case-insensitive natural order", () => {
    for (const type of ["text", "link"] as const) {
      expect(run(col(1, type), ["b", "A", "a10", "a2"], "asc")).toEqual([2, 4, 3, 1]);
      expect(run(col(1, type), ["b", "A", "a10", "a2"], "desc")).toEqual([1, 3, 4, 2]);
    }
  });
  it("number: numeric, not lexical", () => {
    expect(run(col(1, "number"), [10, 9, -1, 2.5], "asc")).toEqual([3, 4, 2, 1]);
    expect(run(col(1, "number"), [10, 9, -1, 2.5], "desc")).toEqual([1, 2, 4, 3]);
  });
  it("date: chronological", () => {
    const d = ["2026-03-10", "2025-12-31", "2026-03-04"];
    expect(run(col(1, "date"), d, "asc")).toEqual([2, 3, 1]);
    expect(run(col(1, "date"), d, "desc")).toEqual([1, 3, 2]);
  });
  it("checkbox: unchecked before checked, missing counts as unchecked", () => {
    const v = [true, false, null, true];
    expect(run(col(1, "checkbox"), v, "asc")).toEqual([3, 2, 4, 1]); // ties newest first
    expect(run(col(1, "checkbox"), v, "desc")).toEqual([4, 1, 3, 2]);
  });
  it("single_select: by option position, not label or id", () => {
    const c = col(1, "single_select", { options: [
      { id: 30, label: "Zed", color: "blue", position: 0 },
      { id: 10, label: "Alpha", color: "blue", position: 1 },
      { id: 20, label: "Mid", color: "blue", position: 2 },
    ] });
    expect(run(c, [20, 10, 30], "asc")).toEqual([3, 2, 1]);
    expect(run(c, [20, 10, 30], "desc")).toEqual([1, 2, 3]);
  });
  it("blanks are last in both directions (null, empty text, deleted option)", () => {
    const sel = col(1, "single_select", { options: [{ id: 1, label: "A", color: "blue", position: 0 }] });
    expect(run(col(1, "text"), [null, "b", "", "a"], "asc")).toEqual([4, 2, 3, 1]);
    expect(run(col(1, "text"), [null, "b", "", "a"], "desc")).toEqual([2, 4, 3, 1]);
    expect(run(col(1, "number"), [null, 0, 5], "asc")).toEqual([2, 3, 1]);
    expect(run(col(1, "number"), [null, 0, 5], "desc")).toEqual([3, 2, 1]);
    expect(run(sel, [99, 1, null], "desc")).toEqual([2, 3, 1]); // 99 = deleted option
  });
  it("ties go newest first (id desc) in both directions", () => {
    expect(run(col(1, "text"), ["x", "X", "x"], "asc")).toEqual([3, 2, 1]);
    expect(run(col(1, "text"), ["x", "X", "x"], "desc")).toEqual([3, 2, 1]);
  });
  it("title sorts like text", () => {
    const rows = [row(1, null, "beta"), row(2, null, "Alpha"), row(3, null, "item 10"), row(4, null, "item 9")];
    expect(ids(sortRows(rows, [], { id: "title", dir: "asc" }))).toEqual([2, 1, 4, 3]);
  });
  it("no sort returns the same array; the input is never mutated", () => {
    const rows = [row(2, "b"), row(1, "a")];
    expect(sortRows(rows, [col(1, "text")], null)).toBe(rows);
    sortRows(rows, [col(1, "text")], { id: "col-1", dir: "asc" });
    expect(ids(rows)).toEqual([2, 1]);
  });
});

describe("URL sort params", () => {
  const visible = [col(1, "text"), col(2, "number")];
  it("accepts title and visible columns with a valid direction", () => {
    expect(parseSort("title", "desc", visible)).toEqual({ id: "title", dir: "desc" });
    expect(parseSort("col-2", "asc", visible)).toEqual({ id: "col-2", dir: "asc" });
  });
  it("falls back to default for anything else", () => {
    expect(parseSort("col-3", "asc", visible)).toBeNull(); // unknown or hidden column
    expect(parseSort("col-1", "up", visible)).toBeNull();
    expect(parseSort("col-1", null, visible)).toBeNull();
    expect(parseSort(null, "asc", visible)).toBeNull();
    expect(parseSort("1", "asc", visible)).toBeNull();
    expect(parseSort("__proto__", "asc", visible)).toBeNull();
  });
  it("cycles ascending, descending, off, and restarts on another column", () => {
    const a = nextSort(null, "col-1");
    expect(a).toEqual({ id: "col-1", dir: "asc" });
    const d = nextSort(a, "col-1");
    expect(d).toEqual({ id: "col-1", dir: "desc" });
    expect(nextSort(d, "col-1")).toBeNull();
    expect(nextSort(d, "col-2")).toEqual({ id: "col-2", dir: "asc" });
  });
  it("writes and clears the params, keeping the others", () => {
    expect(withSort("x=1", { id: "col-1", dir: "desc" })).toBe("x=1&sort=col-1&dir=desc");
    expect(withSort("sort=title&dir=asc&x=1", { id: "col-2", dir: "asc" })).toBe("x=1&sort=col-2&dir=asc");
    expect(withSort("sort=title&dir=asc", null)).toBe("");
  });
});
