import { describe, expect, it } from "vitest";
import { CELL_FIELD, linkLabel, parseCell, readCell, safeHref } from "@/lib/cells";

const value = (type: Parameters<typeof parseCell>[0], raw: unknown) => {
  const r = parseCell(type, raw);
  return r.ok ? r.value : "ERR";
};

describe("parseCell", () => {
  it.each(["text", "number", "date", "link", "checkbox", "single_select"] as const)("%s: blanks are valid blanks", (t) => {
    for (const raw of [null, undefined, "", "   "]) expect(parseCell(t, raw)).toEqual({ ok: true, value: null });
  });

  it("round-trips each type", () => {
    expect(value("text", "  hello ")).toBe("hello");
    expect(value("number", 4.5)).toBe(4.5);
    expect(value("number", " 12 ")).toBe(12);
    expect(value("number", 0)).toBe(0);
    expect(value("date", "2026-02-28")).toBe("2026-02-28");
    expect(value("date", "2024-02-29")).toBe("2024-02-29");
    expect(value("link", " https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(value("checkbox", true)).toBe(true);
    expect(value("checkbox", false)).toBe(false);
    expect(value("single_select", 7)).toBe(7);
    expect(value("single_select", "7")).toBe(7);
  });

  it.each([
    ["number", NaN], ["number", Infinity], ["number", "abc"], ["number", true],
    ["number", "0x10"], ["number", "1e3"], ["number", "Infinity"], ["number", "1,5"], ["number", "--1"], ["number", "1 2"], ["number", "."], ["number", "1".repeat(400)],
    ["date", "2026-02-30"], ["date", "2026-13-01"], ["date", "2025-02-29"], ["date", "26-1-1"], ["date", 20260101],
    ["link", "javascript:alert(1)"], ["link", "ftp://example.com"], ["link", "https://"], ["link", "a b"], ["link", 5],
    ["checkbox", "true"], ["checkbox", 1],
    ["single_select", 1.5], ["single_select", "1.5"], ["single_select", "abc"], ["single_select", NaN], ["single_select", [7]], ["single_select", true], ["single_select", { toString: () => "3" }],
    ["text", 5],
  ] as const)("rejects %s %j", (t, raw) => {
    expect(parseCell(t, raw).ok).toBe(false);
  });

  it("accepts plain decimals for number", () => {
    expect(value("number", "-3.5")).toBe(-3.5);
    expect(value("number", ".5")).toBe(0.5);
    expect(value("number", "+2")).toBe(2);
    expect(value("number", "5.")).toBe(5);
    expect(value("number", "007")).toBe(7);
  });

  it("prepends https:// to a bare host", () => {
    expect(value("link", "example.com")).toBe("https://example.com/");
    expect(value("link", "localhost:8080/x")).toBe("https://localhost:8080/x");
    expect(value("link", "http://example.com")).toBe("http://example.com/");
  });

  // 1.8 decision: links are stored normalised (new URL().href); whitespace and control characters are rejected, not stripped.
  it("normalises stored links", () => {
    expect(value("link", "//example.com")).toBe("https://example.com/");
    expect(value("link", "https:////example.com/x")).toBe("https://example.com/x");
    expect(value("link", "HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
  });

  it.each(["a b", "https://exa mple.com", "https://example.com/a\nb", "https://example.com/\tx", "example.com\u0000", "https://example.com/\u007f", "https://example.com/a\u00a0b"])(
    "rejects whitespace/control characters in a link: %j",
    (raw) => expect(parseCell("link", raw).ok).toBe(false),
  );
});

describe("safeHref", () => {
  it.each(["https://example.com/a?b=1#c", "http://localhost:3000/x"])("passes %s", (u) => {
    expect(safeHref(u)).toBe(new URL(u).href);
  });

  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "ftp://example.com",
    "/relative/path", "example.com", "//example.com", "https://", "http://", "not a url", "", "https://exa\nmple.com",
  ])("rejects %j", (u) => expect(safeHref(u)).toBeNull());
});

describe("linkLabel", () => {
  it("shows host + path, drops a bare slash, and truncates", () => {
    expect(linkLabel("https://example.com/")).toBe("example.com");
    expect(linkLabel("https://example.com/jobs/1?x=2")).toBe("example.com/jobs/1?x=2");
    const long = linkLabel(`https://example.com/${"a".repeat(100)}`);
    expect(long).toHaveLength(40);
    expect(long.endsWith("…")).toBe(true);
    expect(linkLabel("not a url")).toBe("not a url");
  });
});

describe("readCell", () => {
  const row = { valueText: "t", valueNumber: 2, valueDate: "2026-01-01", valueBool: false, valueOptionId: 9 };
  it("reads only the field for the type", () => {
    expect(readCell("text", row)).toBe("t");
    expect(readCell("link", row)).toBe("t");
    expect(readCell("number", row)).toBe(2);
    expect(readCell("date", row)).toBe("2026-01-01");
    expect(readCell("checkbox", row)).toBe(false);
    expect(readCell("single_select", row)).toBe(9);
  });
  it("returns null for a blank field", () => {
    expect(readCell("number", { valueText: "x", valueNumber: null })).toBeNull();
    expect(readCell("text", {})).toBeNull();
  });
  it("maps every type to a field", () => {
    expect(CELL_FIELD.link).toBe(CELL_FIELD.text);
  });
});
