import { describe, expect, it } from "vitest";
import { isId } from "@/lib/ids";

describe("isId", () => {
  it("accepts positive safe integers", () => {
    for (const n of [1, 2, 9007199254740991]) expect(isId(n)).toBe(true);
  });
  it("rejects everything else", () => {
    for (const n of [0, -1, 1.5, NaN, Infinity, 9007199254740992, "1", null, undefined, {}, true]) expect(isId(n)).toBe(false);
  });
});
