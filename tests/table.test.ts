import { describe, expect, it } from "vitest";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { parseCell } from "@/lib/cells";
import { buildColumns, editorKind, formatCell, getRowId } from "@/lib/table";

const col = (id: number, name: string, type: ColumnItem["type"], over: Partial<ColumnItem> = {}): ColumnItem => ({
  id, name, type, hidden: false, isStatus: false, options: [], ...over,
});

describe("formatCell", () => {
  const select = col(1, "S", "single_select", { options: [{ id: 7, label: "Applied", color: "blue", position: 0 }] });

  it("renders each type read-only", () => {
    expect(formatCell(col(1, "t", "text"), "hi")).toBe("hi");
    expect(formatCell(col(1, "n", "number"), 4.5)).toBe("4.5");
    expect(formatCell(col(1, "d", "date"), "2026-03-04")).toBe("2026-03-04");
    expect(formatCell(col(1, "l", "link"), "https://example.com")).toBe("https://example.com");
    expect(formatCell(col(1, "c", "checkbox"), true)).toBe("✓");
    expect(formatCell(col(1, "c", "checkbox"), false)).toBe("");
    expect(formatCell(select, 7)).toBe("Applied");
  });

  it("renders numbers without exponent form, so the editor's draft parses back to the same number", () => {
    const n = col(1, "n", "number");
    expect(formatCell(n, 5e-7)).toBe("0.0000005");
    expect(formatCell(n, 1e21)).toBe("1000000000000000000000");
    expect(formatCell(n, -1.25e-8)).toBe("-0.0000000125");
    for (const v of [5e-7, 1e21, -1.25e-8, 1.7976931348623157e308, 5e-324, 0.1 + 0.2, -42, 0]) {
      expect(parseCell("number", formatCell(n, v))).toEqual({ ok: true, value: v });
    }
  });

  it("renders blank for null, undefined and an unknown option id", () => {
    expect(formatCell(col(1, "t", "text"), null)).toBe("");
    expect(formatCell(col(1, "t", "text"), undefined)).toBe("");
    expect(formatCell(select, 99)).toBe("");
  });
});

describe("buildColumns", () => {
  const cols = [col(5, "B", "text"), col(3, "Hidden", "text", { hidden: true }), col(9, "A", "number")];
  const defs = buildColumns(cols);

  it("puts Title first, skips hidden columns, keeps the given order", () => {
    expect(defs.map((d) => d.header)).toEqual(["Title", "B", "A"]);
    expect(defs.map((d) => d.id)).toEqual(["title", "col-5", "col-9"]);
  });

  it("reads title and cell values, treating a missing key as blank", () => {
    const row: ApplicationRow = { id: 1, title: "T", values: { 9: 2 } };
    const get = (i: number) => (defs[i] as unknown as { accessorFn: (r: ApplicationRow, n: number) => unknown }).accessorFn(row, 0);
    expect(get(0)).toBe("T");
    expect(get(1)).toBeNull();
    expect(get(2)).toBe(2);
  });
});

describe("getRowId / editorKind", () => {
  it("keys rows by application id, not position", () => {
    const row = (id: number): ApplicationRow => ({ id, title: "t", values: {} });
    expect([row(7), row(3)].map(getRowId)).toEqual(["7", "3"]);
  });
  it("text, number, date and link get a text-box editor; checkbox and single_select do not", () => {
    for (const t of ["text", "number", "date", "link"] as const) expect(editorKind(t)).toBe(t);
    expect(editorKind("checkbox")).toBeNull();
    expect(editorKind("single_select")).toBeNull();
  });
});
