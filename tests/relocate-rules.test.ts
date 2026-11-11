import { describe, expect, it } from "vitest";
import { parseExpected, problemsMessage, sameFiles, sumBytes, targetRefusal, type LiveFile } from "@/lib/relocate";

const f = (id: number, size = 1): LiveFile => ({ id, relativePath: `a/${id}.pdf`, sha256: "0".repeat(64), sizeBytes: size });

describe("targetRefusal", () => {
  it("accepts a sibling folder", () => expect(targetRefusal("/data/old", "/data/new", null)).toBeNull());
  it("refuses the current folder, a folder inside it and a folder that contains it", () => {
    expect(targetRefusal("/data/old", "/data/old", null)).toMatch(/outside the current/);
    expect(targetRefusal("/data/old", "/data/old/new", null)).toMatch(/outside the current/);
    expect(targetRefusal("/data/old", "/data", null)).toMatch(/does not contain/);
  });
  it("refuses the backup folder, one inside it and one containing it, but not a name that merely starts the same", () => {
    expect(targetRefusal("/a/old", "/b/backups", "/b/backups")).toMatch(/backup folder/);
    expect(targetRefusal("/a/old", "/b/backups/new", "/b/backups")).toMatch(/backup folder/);
    expect(targetRefusal("/a/old", "/b", "/b/backups")).toMatch(/backup folder/);
    expect(targetRefusal("/a/old", "/b/backups-2", "/b/backups")).toBeNull();
    expect(targetRefusal("/a/old2", "/a/old", null)).toBeNull();
  });
});

describe("sameFiles / sumBytes / parseExpected / problemsMessage", () => {
  it("compares the live set whatever the order, and sees any change", () => {
    expect(sameFiles([f(1), f(2)], [f(2), f(1)])).toBe(true);
    expect(sameFiles([f(1)], [f(1), f(2)])).toBe(false);
    expect(sameFiles([f(1, 5)], [f(1, 6)])).toBe(false);
    expect(sameFiles([], [])).toBe(true);
  });
  it("sums sizes", () => expect(sumBytes([f(1, 3), f(2, 4)])).toBe(7));
  it("parses only the expected shape", () => {
    expect(parseExpected({ fileCount: 2, totalBytes: 10 })).toEqual({ fileCount: 2, totalBytes: 10 });
    for (const bad of [null, 1, {}, { fileCount: -1, totalBytes: 0 }, { fileCount: 1.5, totalBytes: 0 }, { fileCount: "1", totalBytes: 0 }]) expect(parseExpected(bad)).toBeNull();
  });
  it("lists the first few problems and counts the rest", () => {
    const m = problemsMessage(["a (missing)", "b (missing)", "c", "d", "e", "f", "g"]);
    expect(m).toMatch(/^7 files not found/);
    expect(m).toContain("e and 2 more");
    expect(m).not.toContain("f,");
    expect(problemsMessage(["x (missing)"])).toMatch(/^1 file not found/);
  });
});
