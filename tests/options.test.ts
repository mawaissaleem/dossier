import { describe, expect, it } from "vitest";
import { PALETTE, isPaletteToken, nextColor } from "@/lib/colors";
import { MAX_OPTION_LABEL, checkOptionLabel, findOption, isSameIdSet, labelTaken } from "@/lib/options";
import { formatCell } from "@/lib/table";

const opts = [{ id: 1, label: "Applied", color: "blue", position: 0 }, { id: 2, label: "Offer", color: "green", position: 1 }];

describe("findOption", () => {
  it("finds by id and is undefined for unknown or non-number ids", () => {
    expect(findOption(opts, 2)?.label).toBe("Offer");
    for (const id of [3, "1", null, undefined]) expect(findOption(opts, id)).toBeUndefined();
  });
  it("is the lookup the table formatter uses", () => {
    expect(formatCell({ type: "single_select", options: opts }, 1)).toBe("Applied");
    expect(formatCell({ type: "single_select", options: opts }, 99)).toBe("");
  });
});

describe("checkOptionLabel", () => {
  it("trims, and rejects blank, non-string and too long", () => {
    expect(checkOptionLabel("  Hi ")).toEqual({ label: "Hi" });
    expect(checkOptionLabel("x".repeat(MAX_OPTION_LABEL))).toEqual({ label: "x".repeat(MAX_OPTION_LABEL) });
    for (const v of ["", "   ", 5, null]) expect(checkOptionLabel(v)).toEqual({ error: "Label is required." });
    expect(checkOptionLabel("x".repeat(MAX_OPTION_LABEL + 1))).toHaveProperty("error");
  });
});

describe("labelTaken", () => {
  it("is case-insensitive and can skip the option being edited", () => {
    expect(labelTaken(opts, "APPLIED")).toBe(true);
    expect(labelTaken(opts, "applied", 1)).toBe(false);
    expect(labelTaken(opts, "Rejected")).toBe(false);
  });
});

describe("palette helpers", () => {
  it("nextColor is the first unused token, then gray", () => {
    expect(nextColor([])).toBe(PALETTE[0]);
    expect(nextColor([PALETTE[0], PALETTE[2]])).toBe(PALETTE[1]);
    expect(nextColor(PALETTE)).toBe("gray");
  });
  it("isPaletteToken accepts only own palette tokens", () => {
    expect(isPaletteToken("teal")).toBe(true);
    for (const t of ["magenta", "", "constructor", "__proto__", 3, null]) expect(isPaletteToken(t)).toBe(false);
  });
});

describe("isSameIdSet", () => {
  it("accepts any permutation of the current ids", () => {
    expect(isSameIdSet([1, 2, 3], [3, 1, 2])).toBe(true);
    expect(isSameIdSet([], [])).toBe(true);
  });
  it("rejects missing, extra, duplicate, foreign and non-array lists", () => {
    for (const bad of [[1, 2], [1, 2, 3, 4], [1, 1, 2], [1, 2, 9], [1, 2, "3"], "123", null, undefined]) expect(isSameIdSet([1, 2, 3], bad)).toBe(false);
  });
});
