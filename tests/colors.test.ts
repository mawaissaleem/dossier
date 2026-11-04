import { describe, expect, it } from "vitest";
import { CHIP_CLASSES, chipClasses } from "@/lib/colors";

describe("chipClasses", () => {
  it("maps every seed palette token to its own classes", () => {
    for (const t of ["red", "orange", "amber", "green", "teal", "blue", "purple", "gray"]) {
      expect(chipClasses(t)).toBe(CHIP_CLASSES[t]);
      expect(chipClasses(t)).toMatch(/^bg-\S+ text-\S+$/);
    }
  });

  it("falls back to gray for an unknown token, including object-prototype names", () => {
    for (const t of ["", "magenta", "constructor", "__proto__"]) expect(chipClasses(t)).toBe(CHIP_CLASSES.gray);
  });
});
