import { describe, expect, it } from "vitest";
import { createLatest } from "@/lib/latest";

describe("createLatest", () => {
  it("only the newest request is current", () => {
    const l = createLatest();
    const a = l.start();
    expect(l.current(a)).toBe(true);
    const b = l.start();
    expect(l.current(a)).toBe(false);
    expect(l.current(b)).toBe(true);
  });

  it("drops a late reply for an earlier target (impact race)", async () => {
    const l = createLatest();
    let shown: string | null = null;
    const load = (token: number, count: string, ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms)).then(() => { if (l.current(token)) shown = count; });
    const slowA = load(l.start(), "A:5", 20); // opened for A, cancelled
    const fastB = load(l.start(), "B:12", 1); // opened for B
    await Promise.all([slowA, fastB]);
    expect(shown).toBe("B:12");
  });
});
