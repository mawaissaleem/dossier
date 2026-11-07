import { describe, expect, it } from "vitest";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { filterRows, parseFilters, toggleFilter, withFilters, type Filter } from "@/lib/filter";
import { sortRows } from "@/lib/sort";

const opt = (id: number, position: number) => ({ id, label: `o${id}`, color: "blue", position });
const col = (id: number, type: ColumnItem["type"], over: Partial<ColumnItem> = {}): ColumnItem => ({
  id, name: `c${id}`, type, hidden: false, isStatus: false, defaultValue: null, options: [], ...over,
});
// Priority (col 1: options 10 High, 11 Medium, 12 Low), Status (col 2: options 20, 21; hidden), Notes (col 3: text)
const priority = col(1, "single_select", { options: [opt(10, 0), opt(11, 1), opt(12, 2)] });
const status = col(2, "single_select", { hidden: true, options: [opt(20, 0), opt(21, 1)] });
const cols = [priority, status, col(3, "text")];
const row = (id: number, p: ApplicationRow["values"][number], s: ApplicationRow["values"][number] = null): ApplicationRow => ({ id, title: `t${id}`, values: { 1: p, 2: s } });
const rows = [row(1, 10, 20), row(2, 11, 21), row(3, 12, 20), row(4, null, 21), row(5, 99, 20), row(6, 10, 21)]; // 99 = deleted option
const ids = (rs: ApplicationRow[]) => rs.map((r) => r.id);
const f = (id: number, options: number[], blank = false): Filter => ({ id, options, blank });

describe("filterRows", () => {
  it("no filters returns the same array", () => {
    expect(filterRows(rows, cols, [])).toBe(rows);
  });
  it("options of one column are OR", () => {
    expect(ids(filterRows(rows, cols, [f(1, [10, 11])]))).toEqual([1, 2, 6]);
  });
  it("different columns are AND", () => {
    expect(ids(filterRows(rows, cols, [f(1, [10, 11]), f(2, [21])]))).toEqual([2, 6]);
  });
  it("blank matches no value and a deleted option; with options it is OR", () => {
    expect(ids(filterRows(rows, cols, [f(1, [], true)]))).toEqual([4, 5]);
    expect(ids(filterRows(rows, cols, [f(1, [12], true)]))).toEqual([3, 4, 5]);
  });
  it("a hidden column still filters", () => {
    expect(ids(filterRows(rows, cols, [f(2, [20])]))).toEqual([1, 3, 5]);
  });
  it("a filter on a deleted or non-select column is skipped", () => {
    expect(filterRows(rows, cols, [f(77, [10])])).toBe(rows);
    expect(filterRows(rows, cols, [f(3, [10])])).toBe(rows);
  });
  it("a dangling option picks nothing (and never matches the deleted-option rows)", () => {
    expect(ids(filterRows(rows, cols, [f(1, [99])]))).toEqual([]);
  });
  it("composes with sort: filter, then sort", () => {
    const filtered = filterRows(rows, cols, [f(1, [10, 11, 12])]);
    expect(ids(sortRows(filtered, cols, { id: "col-1", dir: "desc" }))).toEqual([3, 2, 6, 1]);
    expect(ids(sortRows(filtered, cols, null))).toEqual([1, 2, 3, 6]); // unsorted keeps the given order
  });
});

describe("parseFilters", () => {
  it("reads options and blank, in the column's option order", () => {
    expect(parseFilters(["1:11.10.blank", "2:21"], cols)).toEqual([f(1, [10, 11], true), f(2, [21])]);
  });
  it("drops options that no longer exist, and a filter left with nothing", () => {
    expect(parseFilters(["1:10.99", "2:99"], cols)).toEqual([f(1, [10])]);
  });
  it("drops unknown columns, non-select columns and repeated columns", () => {
    expect(parseFilters(["77:10", "3:10", "1:10", "1:11"], cols)).toEqual([f(1, [10])]);
  });
  it("ignores malformed, oversized and prototype-like entries", () => {
    const bad = ["", "1", "1:", ":10", "1:ten", "1:10..11", "1:10.", "a:10", "-1:10", "1:010", "1: 10", "__proto__", "__proto__:10", "constructor:blank", "1:blank.__proto__", "1:10".padEnd(2000, ".10"), "1:99999999999999999999"];
    expect(parseFilters(bad, cols)).toEqual([]);
    expect(parseFilters(bad.concat("2:20"), cols)).toEqual([f(2, [20])]);
  });
  it("reads at most 50 params", () => {
    const many = Array.from({ length: 50 }, () => "99:1").concat("1:10");
    expect(parseFilters(many, cols)).toEqual([]);
  });
});

describe("withFilters", () => {
  it("round trips through the URL and keeps other params", () => {
    const filters = [f(1, [10, 11], true), f(2, [21])];
    const q = withFilters("sort=title&dir=asc&f=9%3A1", filters);
    const p = new URLSearchParams(q);
    expect(p.get("sort")).toBe("title");
    expect(p.get("dir")).toBe("asc");
    expect(p.getAll("f")).toEqual(["1:10.11.blank", "2:21"]);
    expect(parseFilters(p.getAll("f"), cols)).toEqual(filters);
  });
  it("clears the f params with no filters, skips empty ones", () => {
    expect(withFilters("f=1%3A10&sort=title", [])).toBe("sort=title");
    expect(withFilters("", [f(1, [])])).toBe("");
  });
});

describe("toggleFilter", () => {
  it("adds, extends, and removes a column when its last option is unticked", () => {
    let fs = toggleFilter([], 1, 10);
    expect(fs).toEqual([f(1, [10])]);
    fs = toggleFilter(fs, 2, "blank");
    expect(fs).toEqual([f(1, [10]), f(2, [], true)]);
    fs = toggleFilter(fs, 1, 11);
    expect(fs[0]).toEqual(f(1, [10, 11]));
    fs = toggleFilter(toggleFilter(fs, 1, 10), 1, 11);
    expect(fs).toEqual([f(2, [], true)]);
    expect(toggleFilter(fs, 2, "blank")).toEqual([]);
  });
  it("does not mutate its input", () => {
    const a = [f(1, [10])];
    toggleFilter(a, 1, 11);
    expect(a).toEqual([f(1, [10])]);
  });
});
