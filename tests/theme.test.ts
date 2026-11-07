import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("accepts the three theme names", () => {
    for (const t of THEMES) expect(parseTheme(t)).toBe(t);
  });
  it("falls back to Graphite for unknown or tampered values", () => {
    expect(DEFAULT_THEME).toBe("graphite");
    for (const v of [null, undefined, "", "dark", "Ink", "constructor", "__proto__", "ink; x", 3, {}, ["ink"]]) expect(parseTheme(v)).toBe("graphite");
  });
});

// Runs the real inline script against a fake localStorage/document.
const run = (storage: { getItem: (k: string) => string | null }) => {
  const attrs: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  new Function("localStorage", "document", THEME_INIT_SCRIPT)(storage, document);
  return attrs["data-theme"];
};

describe("THEME_INIT_SCRIPT", () => {
  it("applies a stored valid theme", () => {
    expect(run({ getItem: (k) => (k === THEME_STORAGE_KEY ? "paper" : null) })).toBe("paper");
  });
  it("applies Graphite for a missing or tampered value", () => {
    expect(run({ getItem: () => null })).toBe("graphite");
    expect(run({ getItem: () => '"><script>x</script>' })).toBe("graphite");
  });
  it("does not throw when storage is blocked", () => {
    expect(run({ getItem: () => { throw new Error("denied"); } })).toBeUndefined();
  });
});
