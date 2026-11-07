import { describe, expect, it } from "vitest";
import { chordLabel, highlightSegments, isMacPlatform, isSearchChord, wrapIndex } from "@/lib/search-palette";

const key = (o: Partial<Parameters<typeof isSearchChord>[0]>) => ({ key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe("highlightSegments", () => {
  it("marks a match and keeps the original text", () => {
    expect(highlightSegments("Acme Robotics - Dev", "robotics")).toEqual([
      { text: "Acme ", match: false },
      { text: "Robotics", match: true },
      { text: " - Dev", match: false },
    ]);
  });
  it("ignores case and accents in both directions", () => {
    expect(highlightSegments("Uni Zürich", "ZURICH").find((s) => s.match)?.text).toBe("Zürich");
    expect(highlightSegments("Ecole", "école").find((s) => s.match)?.text).toBe("Ecole");
    expect(highlightSegments("Zu\u0308rich", "zurich").find((s) => s.match)?.text).toBe("Zu\u0308rich"); // decomposed input (u + combining diaeresis)
  });
  it("marks every word and every occurrence, and merges overlaps", () => {
    expect(highlightSegments("ab ab cd", "ab cd").filter((s) => s.match).map((s) => s.text)).toEqual(["ab", "ab", "cd"]);
    expect(highlightSegments("abcd", "abc bcd")).toEqual([{ text: "abcd", match: true }]);
  });
  it("treats markup and regex characters as plain text", () => {
    expect(highlightSegments("<b>x</b> (a+b)", "(a+b)")).toEqual([{ text: "<b>x</b> ", match: false }, { text: "(a+b)", match: true }]);
    expect(highlightSegments("<img src=x onerror=1>", "img").map((s) => s.text).join("")).toBe("<img src=x onerror=1>");
  });
  it("returns one plain run for a blank query or no match, and nothing for empty text", () => {
    expect(highlightSegments("Acme", "  ")).toEqual([{ text: "Acme", match: false }]);
    expect(highlightSegments("Acme", "zzz")).toEqual([{ text: "Acme", match: false }]);
    expect(highlightSegments("", "a")).toEqual([]);
  });
  it("always joins back to the input", () => {
    for (const [t, q] of [["…ate Zürich – École", "ecole zur"], ["a😀b", "b"], ["İstanbul", "istanbul"]]) expect(highlightSegments(t, q).map((s) => s.text).join("")).toBe(t);
  });
});

describe("platform and chord", () => {
  it("detects macOS and iOS platforms", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("iPhone")).toBe(true);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
    expect(isMacPlatform("Win32")).toBe(false);
  });
  it("labels the shortcut per platform", () => {
    expect(chordLabel(true)).toBe("⌘K");
    expect(chordLabel(false)).toBe("Ctrl K");
  });
  it("matches Ctrl+K off macOS and Cmd+K on macOS only", () => {
    expect(isSearchChord(key({ ctrlKey: true }), false)).toBe(true);
    expect(isSearchChord(key({ key: "K", ctrlKey: true }), false)).toBe(true);
    expect(isSearchChord(key({ metaKey: true }), false)).toBe(false);
    expect(isSearchChord(key({ metaKey: true }), true)).toBe(true);
    expect(isSearchChord(key({ ctrlKey: true }), true)).toBe(false);
    expect(isSearchChord(key({}), false)).toBe(false);
    expect(isSearchChord(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSearchChord(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isSearchChord(key({ key: "j", ctrlKey: true }), false)).toBe(false);
  });
});

describe("wrapIndex", () => {
  it("moves and wraps at both ends", () => {
    expect(wrapIndex(0, 1, 3)).toBe(1);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(1, -1, 3)).toBe(0);
  });
  it("is 0 for an empty list", () => {
    expect(wrapIndex(0, 1, 0)).toBe(0);
    expect(wrapIndex(0, -1, 0)).toBe(0);
  });
});
