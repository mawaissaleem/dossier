import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, mix } from "@/lib/contrast";
import { PALETTE } from "@/lib/colors";
import { THEMES } from "@/lib/theme";

// Resolve each theme's tokens from app/globals.css the way the cascade does: blocks in file order, applying
// those whose selector list has :root or the theme's [data-theme] selector.
const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(",").map((s) => s.trim()), body: m[2] }));
const tokens = (theme: string) => {
  const out: Record<string, string> = {};
  for (const b of blocks) {
    if (!b.selectors.some((s) => s === ":root" || s === `[data-theme="${theme}"]`)) continue;
    for (const m of b.body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  }
  return out;
};

describe.each(THEMES)("%s theme contrast (WCAG AA)", (theme) => {
  const t = tokens(theme);
  const surfaces = ["--background", "--card", "--muted", "--popover"];

  it("body and muted text reach 4.5:1 on every surface", () => {
    for (const s of surfaces) {
      expect(contrast(t["--foreground"], t[s]), `foreground on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--muted-foreground"], t[s]), `muted-foreground on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--accent"], t[s]), `accent text on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--destructive"], t[s]), `destructive text on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("accent and destructive buttons have readable text", () => {
    expect(contrast(t["--accent-foreground"], t["--accent"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--destructive-foreground"], t["--destructive"])).toBeGreaterThanOrEqual(4.5);
  });
  it("control borders and the focus ring reach 3:1 on every surface a control sits on", () => {
    for (const s of surfaces) {
      expect(contrast(t["--input"], t[s]), `input border on ${s}`).toBeGreaterThanOrEqual(3);
      expect(contrast(t["--ring"], t[s]), `focus ring on ${s}`).toBeGreaterThanOrEqual(3);
      expect(contrast(t["--destructive"], t[s]), `invalid border on ${s}`).toBeGreaterThanOrEqual(3);
    }
  });
  it("solid button hover (bg-primary/90, bg-destructive/90 over the page) keeps the label readable", () => {
    expect(contrast(t["--accent-foreground"], mix(t["--accent"], t["--background"], 0.9))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--destructive-foreground"], mix(t["--destructive"], t["--popover"], 0.9))).toBeGreaterThanOrEqual(4.5);
  });
  it("the selected colour swatch border (foreground) stands out from every chip colour", () => {
    for (const p of PALETTE) expect(contrast(t["--foreground"], t[`--chip-${p}`]), `swatch ${p}`).toBeGreaterThanOrEqual(3);
  });
  it("every palette token has a chip pair with 4.5:1 text", () => {
    for (const p of PALETTE) {
      expect(contrast(t[`--chip-${p}-foreground`], t[`--chip-${p}`]), `chip ${p}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
