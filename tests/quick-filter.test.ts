import { describe, expect, it } from "vitest";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import type { Filter } from "@/lib/filter";
import { optionCounts, quickColumns } from "@/lib/quick-filter";

const opt = (id: number, position: number) => ({ id, label: `o${id}`, color: "blue", position });
const col = (id: number, name: string, type: ColumnItem["type"], over: Partial<ColumnItem> = {}): ColumnItem => ({
  id, name, type, hidden: false, isStatus: false, defaultValue: null, options: [], ...over,
});
const names = (cs: { name: string }[]) => cs.map((c) => c.name);

describe("quickColumns", () => {
  it("returns Status (isStatus flag, not name) then Priority, whatever the column order", () => {
    const cols = [col(1, "Priority", "single_select"), col(2, "Status", "single_select"), col(3, "Stage", "single_select", { isStatus: true })];
    expect(names(quickColumns(cols))).toEqual(["Stage", "Priority"]);
  });
  it("matches Priority trimmed and case-insensitive, and needs single_select", () => {
    expect(names(quickColumns([col(1, "  PRIORITY ", "single_select")]))).toEqual(["  PRIORITY "]);
    expect(quickColumns([col(1, "Priority", "text")])).toEqual([]);
  });
  it("omits a group the track does not have", () => {
    expect(names(quickColumns([col(1, "Stage", "single_select", { isStatus: true })]))).toEqual(["Stage"]);
    expect(quickColumns([col(1, "Notes", "text")])).toEqual([]);
  });
  it("includes hidden Status and Priority columns", () => {
    const cols = [col(1, "Stage", "single_select", { isStatus: true, hidden: true }), col(2, "Priority", "single_select", { hidden: true })];
    expect(names(quickColumns(cols))).toEqual(["Stage", "Priority"]);
  });
  it("takes the first of two Priority columns, and never the Status column as Priority", () => {
    const cols = [col(1, "Priority", "single_select", { isStatus: true }), col(2, "Priority", "single_select"), col(3, "priority", "single_select")];
    expect(quickColumns(cols).map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("optionCounts", () => {
  const priority = col(1, "Priority", "single_select", { options: [opt(10, 0), opt(11, 1)] });
  const status = col(2, "Status", "single_select", { isStatus: true, options: [opt(20, 0), opt(21, 1)] });
  const cols = [priority, status];
  const row = (id: number, p: ApplicationRow["values"][number], s: ApplicationRow["values"][number]): ApplicationRow => ({ id, title: `t${id}`, values: { 1: p, 2: s } });
  const rows = [row(1, 10, 20), row(2, 11, 20), row(3, 10, 21), row(4, null, 21), row(5, 99, 20)]; // 99 = deleted option
  const f = (id: number, options: number[], blank = false): Filter => ({ id, options, blank });
  const obj = (m: Map<number, number>) => Object.fromEntries(m);

  it("counts every option, zero included, ignoring blanks and deleted options", () => {
    expect(obj(optionCounts(rows, cols, [], priority))).toEqual({ 10: 2, 11: 1 });
    expect(obj(optionCounts([], cols, [], priority))).toEqual({ 10: 0, 11: 0 });
  });
  it("respects other columns' filters", () => {
    expect(obj(optionCounts(rows, cols, [f(2, [20])], priority))).toEqual({ 10: 1, 11: 1 });
  });
  it("ignores the column's own filter, so a sibling chip shows what it would add", () => {
    expect(obj(optionCounts(rows, cols, [f(1, [10])], priority))).toEqual({ 10: 2, 11: 1 });
    expect(obj(optionCounts(rows, cols, [f(1, [10]), f(2, [21])], priority))).toEqual({ 10: 1, 11: 0 });
  });
});
