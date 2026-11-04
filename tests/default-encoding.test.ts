import { describe, expect, it } from "vitest";
import { decodeDefault, encodeDefault, parseCell, type CellScalar } from "@/lib/cells";
import type { ColumnType } from "@/lib/db/schema";

describe("encodeDefault / decodeDefault", () => {
  it.each<[ColumnType, CellScalar, string]>([
    ["text", "Remote", "Remote"],
    ["number", 4.5, "4.5"],
    ["number", 0, "0"],
    ["number", -3, "-3"],
    ["number", 1e21, "1e+21"],
    ["date", "2026-02-28", "2026-02-28"],
    ["link", "https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["checkbox", true, "true"],
    ["checkbox", false, "false"],
    ["single_select", 12, "12"],
  ])("%s %j encodes to %j and decodes back", (type, value, text) => {
    expect(encodeDefault(value)).toBe(text);
    expect(decodeDefault(type, text)).toBe(value);
  });

  it("round-trips whatever parseCell accepts for each type", () => {
    for (const [type, raw] of [["text", "  hi "], ["number", " 7.25 "], ["date", "2024-02-29"], ["link", "example.com"], ["checkbox", false], ["single_select", "9"]] as const) {
      const p = parseCell(type, raw);
      if (!p.ok || p.value === null) throw new Error("fixture");
      expect(decodeDefault(type, encodeDefault(p.value))).toBe(p.value);
    }
  });

  it.each<[ColumnType, string | null]>([
    ["text", null], ["text", ""], ["text", "   "],
    ["number", ""], ["number", "abc"], ["number", "0x10"], ["number", " 5"], ["number", "1e3"],
    ["date", "2026-02-30"], ["date", "tomorrow"],
    ["link", "javascript:alert(1)"], ["link", "has space.com"],
    ["checkbox", "yes"], ["checkbox", "1"], ["checkbox", ""],
    ["single_select", "abc"], ["single_select", "-1"], ["single_select", "1.5"],
  ])("%s %j decodes to null (no default)", (type, text) => {
    expect(decodeDefault(type, text)).toBeNull();
  });
});
