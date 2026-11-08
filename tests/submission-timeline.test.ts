import { describe, expect, it } from "vitest";
import { fileCountLabel } from "@/lib/submission-timeline";

describe("fileCountLabel", () => {
  it("handles zero, one and many", () => {
    expect(fileCountLabel(0)).toBe("No files");
    expect(fileCountLabel(1)).toBe("1 file");
    expect(fileCountLabel(3)).toBe("3 files");
  });
});
