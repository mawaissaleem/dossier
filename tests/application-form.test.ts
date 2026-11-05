import { describe, expect, it } from "vitest";
import { buildCreateValues, buildValues, defaultState, changedState, errorNamesColumn, initialState, inputKind, splitEssentials } from "@/lib/application-form";
import type { ColumnType } from "@/lib/db/schema";

describe("inputKind", () => {
  it("maps every column type to an input", () => {
    expect(inputKind("text")).toBe("text");
    expect(inputKind("link")).toBe("text");
    expect(inputKind("number")).toBe("number");
    expect(inputKind("date")).toBe("date");
    expect(inputKind("checkbox")).toBe("checkbox");
    expect(inputKind("single_select")).toBe("select");
  });
});

describe("buildValues", () => {
  const cols = [
    { id: 1, type: "text" as const, options: [] }, { id: 2, type: "single_select" as const, options: [{ id: 7 }] },
    { id: 3, type: "checkbox" as const, options: [] }, { id: 4, type: "number" as const, options: [] },
  ];

  it("omits untouched columns", () => {
    expect(buildValues(cols, {})).toEqual([]);
  });

  it("sends blank as null, select as a number, checkbox as a boolean, text as typed", () => {
    expect(buildValues(cols, { 1: "  ", 2: "7", 3: false, 4: "4.5" })).toEqual([
      { columnId: 1, value: null }, { columnId: 2, value: 7 }, { columnId: 3, value: false }, { columnId: 4, value: "4.5" },
    ]);
    expect(buildValues(cols, { 2: "" })).toEqual([{ columnId: 2, value: null }]);
  });

  it("drops state of columns that no longer exist and follows column order, not state order", () => {
    expect(buildValues(cols, { 99: "x", 3: true, 1: "a" })).toEqual([{ columnId: 1, value: "a" }, { columnId: 3, value: true }]);
  });

  it("sends a select option deleted while the form was open as blank, like the select shows", () => {
    const sel = [{ id: 2, type: "single_select" as const, options: [{ id: 8 }] }];
    expect(buildValues(sel, { 2: "7" })).toEqual([{ columnId: 2, value: null }]);
    expect(buildValues(sel, { 2: "8" })).toEqual([{ columnId: 2, value: 8 }]);
  });
});

describe("splitEssentials", () => {
  let n = 0;
  const col = (name: string, type: ColumnType = "text", o: { hidden?: boolean; isStatus?: boolean } = {}) =>
    ({ id: ++n, name, type, hidden: false, isStatus: false, ...o });
  const names = (cs: { name: string }[]) => cs.map((c) => c.name);

  it("puts status, priority, deadline first in that fixed order, the rest in column order", () => {
    const cols = [col("Company"), col("Deadline", "date"), col("Notes"), col("Priority", "single_select"), col("Stage", "single_select", { isStatus: true })];
    const { essentials, rest } = splitEssentials(cols);
    expect(names(essentials)).toEqual(["Stage", "Priority", "Deadline"]);
    expect(names(rest)).toEqual(["Company", "Notes"]);
  });

  it("matches names case-insensitively and trimmed, but requires the expected type", () => {
    const { essentials, rest } = splitEssentials([col("  PRIORITY ", "single_select"), col("deadline", "text"), col("Priority", "text")]);
    expect(names(essentials)).toEqual(["  PRIORITY "]);
    expect(names(rest)).toEqual(["deadline", "Priority"]);
  });

  it("uses the isStatus flag, not the name", () => {
    const { essentials, rest } = splitEssentials([col("Status", "single_select"), col("Phase", "single_select", { isStatus: true })]);
    expect(names(essentials)).toEqual(["Phase"]);
    expect(names(rest)).toEqual(["Status"]);
  });

  it("shows fewer essentials when some are missing, and none for a track without any", () => {
    expect(names(splitEssentials([col("Priority", "single_select")]).essentials)).toEqual(["Priority"]);
    expect(splitEssentials([col("A")])).toMatchObject({ essentials: [], rest: [{ name: "A" }] });
    expect(splitEssentials([])).toEqual({ essentials: [], rest: [] });
  });

  it("keeps hidden columns in rest even when they match a rule", () => {
    const { essentials, rest } = splitEssentials([col("Priority", "single_select", { hidden: true }), col("Deadline", "date", { hidden: true }), col("S", "single_select", { isStatus: true, hidden: true })]);
    expect(essentials).toEqual([]);
    expect(rest).toHaveLength(3);
  });

  it("takes the first of two matches; a newly added column lands in rest", () => {
    const { essentials, rest } = splitEssentials([col("Deadline", "date"), col("Deadline", "date"), col("Brand new")]);
    expect(essentials).toHaveLength(1);
    expect(names(rest)).toEqual(["Deadline", "Brand new"]);
  });
});

describe("errorNamesColumn", () => {
  it("is true only when the error starts with a listed column name and colon", () => {
    const cols = [{ name: "Salary" }];
    expect(errorNamesColumn("Salary: not a number.", cols)).toBe(true);
    expect(errorNamesColumn("Title is required.", cols)).toBe(false);
    expect(errorNamesColumn(null, cols)).toBe(false);
  });

  it("does not confuse a name that is a prefix of another (Link vs Link 2)", () => {
    expect(errorNamesColumn("Link 2: bad", [{ name: "Link" }])).toBe(false);
    expect(errorNamesColumn("Link: bad", [{ name: "Link 2" }])).toBe(false);
    expect(errorNamesColumn("Link 2: bad", [{ name: "Link" }, { name: "Link 2" }])).toBe(true);
  });
});

describe("initialState and changedState", () => {
  const cols = [
    { id: 1, type: "text" as const, options: [] }, { id: 2, type: "number" as const, options: [] }, { id: 3, type: "checkbox" as const, options: [] },
    { id: 4, type: "single_select" as const, options: [{ id: 9, label: "Offer", color: "blue", position: 0 }] }, { id: 5, type: "date" as const, options: [] },
    { id: 6, type: "link" as const, options: [] },
  ];

  it("fills every column from the loaded values: blank is empty, a blank checkbox is unchecked, a select is its option id", () => {
    expect(initialState(cols, { 1: "hi", 2: 5e-7, 3: null, 4: 9, 5: null, 6: "https://a.example/" })).toEqual({ 1: "hi", 2: "0.0000005", 3: false, 4: "9", 5: "", 6: "https://a.example/" });
    expect(initialState(cols, { 1: null, 2: 0, 3: false, 4: null, 5: "2026-03-04", 6: null })).toEqual({ 1: "", 2: "0", 3: false, 4: "", 5: "2026-03-04", 6: "" });
  });

  it("returns nothing when nothing changed, even after retyping the same text or checking and unchecking a box", () => {
    const init = initialState(cols, { 1: "hi", 2: 3, 3: null, 4: 9, 5: null, 6: null });
    expect(changedState(cols, { ...init }, init)).toEqual({});
    expect(changedState(cols, { ...init, 1: " hi ", 3: false, 5: "  " }, init)).toEqual({});
  });

  it("returns only the changed columns, with the state value, including clears and unchecking", () => {
    const init = initialState(cols, { 1: "hi", 2: 3, 3: true, 4: 9, 5: "2026-03-04", 6: null });
    expect(changedState(cols, { ...init, 1: "", 3: false, 4: "", 6: "x.example" }, init)).toEqual({ 1: "", 3: false, 4: "", 6: "x.example" });
    expect(changedState(cols, { ...init, 2: "3.0" }, init)).toEqual({ 2: "3.0" }); // compared as text
  });

  it("ignores state of columns that are not in the list, and columns missing from initial count as blank", () => {
    expect(changedState(cols, { 99: "x" }, {})).toEqual({});
    expect(changedState(cols, { 1: "new", 3: false }, {})).toEqual({ 1: "new" });
  });
});

describe("defaultState", () => {
  const col = (id: number, type: ColumnType, defaultValue: string | null, options: number[] = []) =>
    ({ id, type, defaultValue, options: options.map((o) => ({ id: o, label: "x", color: "blue", position: o })) });

  it("shows each type's default as its input value", () => {
    const cols = [col(1, "text", "Remote"), col(2, "number", "4.5"), col(3, "date", "2026-03-04"), col(4, "link", "https://a.com/"), col(5, "checkbox", "true"), col(6, "checkbox", "false"), col(7, "single_select", "9", [8, 9])];
    expect(defaultState(cols)).toEqual({ 1: "Remote", 2: "4.5", 3: "2026-03-04", 4: "https://a.com/", 5: true, 6: false, 7: "9" });
  });

  it("leaves out no-default, invalid and dangling defaults (they show blank)", () => {
    const cols = [col(1, "text", null), col(2, "number", "abc"), col(3, "date", "2026-13-40"), col(4, "checkbox", "yes"), col(5, "single_select", "99", [8]), col(6, "single_select", "x", [8])];
    expect(defaultState(cols)).toEqual({});
  });
});

describe("buildCreateValues", () => {
  const cols = [
    { id: 1, type: "text" as const, defaultValue: "Remote", options: [] }, { id: 2, type: "checkbox" as const, defaultValue: "true", options: [] },
    { id: 3, type: "single_select" as const, defaultValue: "7", options: [{ id: 7, label: "A", color: "blue", position: 0 }] },
    { id: 4, type: "date" as const, defaultValue: null, options: [] }, { id: 5, type: "checkbox" as const, defaultValue: null, options: [] },
  ];

  it("sends every column with the shown value: defaults when untouched, blank when no default", () => {
    expect(buildCreateValues(cols, {})).toEqual([
      { columnId: 1, value: "Remote" }, { columnId: 2, value: true }, { columnId: 3, value: 7 }, { columnId: 4, value: null }, { columnId: 5, value: null },
    ]);
  });

  it("a cleared or changed pre-filled field is sent as shown", () => {
    expect(buildCreateValues(cols, { 1: "", 2: false, 3: "" })).toEqual([
      { columnId: 1, value: null }, { columnId: 2, value: false }, { columnId: 3, value: null }, { columnId: 4, value: null }, { columnId: 5, value: null },
    ]);
  });
});
