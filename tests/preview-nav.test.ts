import { describe, expect, it } from "vitest";
import { positionLabel, previewItems, stepIndex } from "@/lib/preview-nav";

const f = (id: number, storedName: string, deletedAt?: Date | null) => ({
  id,
  originalName: `orig-${id}`,
  storedName,
  deletedAt,
});

describe("previewItems", () => {
  it("keeps PDFs and images in list order, drops text, other types and deleted files", () => {
    const list = [
      f(1, "a.pdf"),
      f(2, "b.txt"),
      f(3, "c.PNG"),
      f(4, "d.pdf", new Date()),
      f(5, "e.docx"),
      f(6, "f.pdf", null),
    ];
    expect(previewItems(list)).toEqual([
      { id: 1, name: "orig-1", storedName: "a.pdf", kind: "pdf" },
      { id: 3, name: "orig-3", storedName: "c.PNG", kind: "image" },
      { id: 6, name: "orig-6", storedName: "f.pdf", kind: "pdf" },
    ]);
  });
  it("is empty for no files", () => expect(previewItems([])).toEqual([]));
});

describe("stepIndex (no wrap)", () => {
  it("moves by one inside the list", () => {
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, -1)).toBe(0);
  });
  it("has no neighbour past either end", () => {
    expect(stepIndex(0, 3, -1)).toBeNull();
    expect(stepIndex(2, 3, 1)).toBeNull();
    expect(stepIndex(0, 1, 1)).toBeNull();
    expect(stepIndex(0, 1, -1)).toBeNull();
  });
  it("has no neighbour from a position outside the list (the file left it)", () => {
    expect(stepIndex(-1, 3, 1)).toBeNull();
    expect(stepIndex(3, 3, -1)).toBeNull();
  });
});

describe("positionLabel", () => {
  it("is one-based", () => {
    expect(positionLabel(0, 3)).toBe("1 of 3");
    expect(positionLabel(2, 3)).toBe("3 of 3");
  });
});
