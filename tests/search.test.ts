import { describe, expect, it } from "vitest";
import { clampLimit, foldText, matchApplication, parseSearchQuery, rankHits, searchWords, TIER } from "@/lib/search";

const tier = (q: string, title: string) => matchApplication(searchWords(q), title, [])?.tier;

describe("parseSearchQuery", () => {
  it("trims, treats missing/blank as empty, rejects non-strings and over 200 characters", () => {
    expect(parseSearchQuery("  acme ")).toEqual({ ok: true, query: "acme" });
    expect(parseSearchQuery(null)).toEqual({ ok: true, query: "" });
    expect(parseSearchQuery("   ")).toEqual({ ok: true, query: "" });
    expect(parseSearchQuery(5).ok).toBe(false);
    expect(parseSearchQuery("a".repeat(200)).ok).toBe(true);
    expect(parseSearchQuery("a".repeat(201)).ok).toBe(false);
    expect(parseSearchQuery(" " + "a".repeat(200) + " ").ok).toBe(true); // length is checked after trimming
  });
});

describe("clampLimit", () => {
  it("defaults to 20, caps at 50, floors fractions", () => {
    expect([clampLimit(undefined), clampLimit(NaN), clampLimit(0), clampLimit(-3), clampLimit("5")]).toEqual([20, 20, 20, 20, 20]);
    expect([clampLimit(7), clampLimit(7.9), clampLimit(50), clampLimit(500)]).toEqual([7, 7, 50, 50]);
  });
});

describe("foldText", () => {
  it("lower-cases and strips accents, also for decomposed input", () => {
    expect(foldText("Zürich ÉCOLE Łódź")).toBe("zurich ecole łodz"); // "Ł" has no accent mark: it only lower-cases
    expect(foldText("Zürich")).toBe("zurich");
  });
});

describe("tiers", () => {
  it("exact > prefix > word start > contains > cell", () => {
    expect(tier("acme", "Acme")).toBe(TIER.exact);
    expect(tier("ACME", "  acme ")).toBe(TIER.exact);
    expect(tier("acme", "Acme Robotics")).toBe(TIER.prefix);
    expect(tier("robot", "Acme Robotics")).toBe(TIER.wordStart);
    expect(tier("bot", "Acme Robotics")).toBe(TIER.contains);
    expect(tier("robotics acme", "Acme Robotics")).toBe(TIER.contains); // every word in the title, but not as a phrase
    const m = matchApplication(["zurich"], "Acme", [{ column: "City", text: "Zürich" }]);
    expect(m?.tier).toBe(TIER.cell);
  });
  it("sorts by tier, then newest (highest id) first", () => {
    const hits = [{ id: 1, tier: 3 }, { id: 2, tier: 0 }, { id: 3, tier: 3 }, { id: 4, tier: 4 }, { id: 5, tier: 1 }];
    expect(rankHits(hits).map((h) => h.id)).toEqual([2, 5, 3, 1, 4]);
  });
});

describe("notes", () => {
  const cells = [{ column: "City", text: "Berlin" }];
  it("match as kind note, with a snippet, and rank below title and cell matches", () => {
    const m = matchApplication(["zurich"], "Acme", cells, ["Call about Zürich"])!;
    expect(m).toEqual({ tier: TIER.note, matched: { kind: "note", column: null, snippet: "Call about Zürich" } });
    expect(matchApplication(["berlin"], "Acme", cells, ["berlin too"])!.tier).toBe(TIER.cell);
    expect(matchApplication(["acme"], "Acme", cells, ["acme too"])!.tier).toBe(TIER.exact);
    expect(TIER.cell).toBeLessThan(TIER.note);
  });
  it("count towards every word: a query may split across title, cells and notes", () => {
    expect(matchApplication(["acme", "berlin", "visa"], "Acme", cells, ["visa pending"])).not.toBeNull();
    expect(matchApplication(["acme", "visa"], "Acme", cells, ["visa pending"])!.tier).toBe(TIER.note); // the note was needed
    expect(matchApplication(["acme", "paris"], "Acme", cells, ["visa pending"])).toBeNull();
  });
  it("pick the note with most words, the first given on a tie, and cut the snippet from it", () => {
    const m = matchApplication(["visa", "pending"], "Acme", [], ["visa only", "visa pending", "pending visa"])!;
    expect(m.matched.snippet).toBe("visa pending");
    expect(matchApplication(["visa"], "Acme", [], ["visa one", "visa two"])!.matched.snippet).toBe("visa one");
    const long = matchApplication(["zurich"], "Acme", [], ["x".repeat(60) + " Zürich " + "y".repeat(60)])!.matched.snippet;
    expect(long.startsWith("…") && long.endsWith("…") && long.includes("Zürich")).toBe(true);
  });
});

describe("matchApplication", () => {
  it("needs every word, across the title and different cells", () => {
    const cells = [{ column: "City", text: "Berlin" }, { column: "Notes", text: "referral from Dana" }];
    expect(matchApplication(["acme", "berlin", "dana"], "Acme", cells)).not.toBeNull();
    expect(matchApplication(["acme", "paris"], "Acme", cells)).toBeNull();
    expect(matchApplication([], "Acme", cells)).toBeNull();
  });
  it("reports the field with most words and a snippet from the original text", () => {
    const text = "x".repeat(60) + " Zürich campus " + "y".repeat(60);
    const m = matchApplication(["zurich"], "Acme", [{ column: "Where", text }])!;
    expect(m.matched).toMatchObject({ kind: "cell", column: "Where" });
    expect(m.matched.snippet.startsWith("…")).toBe(true);
    expect(m.matched.snippet.endsWith("…")).toBe(true);
    expect(m.matched.snippet).toContain("Zürich campus");
    expect(m.matched.snippet.length).toBeLessThan(90);
    expect(matchApplication(["acme"], "Acme", [{ column: "A", text: "acme" }])!.matched.kind).toBe("title"); // tie: title first
  });
});
