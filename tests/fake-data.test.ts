import { describe, expect, it } from "vitest";
import { parseCell } from "@/lib/cells";
import { KNOWN_COMPANIES, KNOWN_UNIVERSITIES, generateApplications, type FakeColumn } from "@/lib/fake-data";
import { mulberry32 } from "@/lib/prng";

const opts = (start: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: start + i }));
const col = (id: number, name: string, type: FakeColumn["type"], over: Partial<FakeColumn> = {}): FakeColumn => ({ id, name, type, isStatus: false, options: [], ...over });
// A Job-like track plus one custom column of every type, so nothing depends on a hard-coded list.
const COLS: FakeColumn[] = [
  col(1, "Status", "single_select", { isStatus: true, options: opts(100, 6) }),
  col(2, "Company", "text"), col(3, "Role", "text"),
  col(4, "Priority", "single_select", { options: opts(200, 2) }),
  col(5, "Deadline", "date"), col(6, "Follow-up date", "date"), col(7, "Link", "link"), col(8, "Location", "text"),
  col(9, "Notes", "text"), col(10, "Salary", "number"), col(11, "Referral", "checkbox"), col(12, "Stage", "single_select", { options: opts(300, 3) }),
];
const gen = (seed = 1, count = 500, cols = COLS) => generateApplications(cols, count, mulberry32(seed));

describe("mulberry32", () => {
  it("repeats for a seed, differs between seeds, and stays in [0, 1)", () => {
    const a = Array.from({ length: 5 }, mulberry32(7)), b = Array.from({ length: 5 }, mulberry32(7));
    expect(a).toEqual(b);
    expect(Array.from({ length: 5 }, mulberry32(8))).not.toEqual(a);
    const r = mulberry32(3);
    for (let i = 0; i < 1000; i++) { const x = r(); expect(x >= 0 && x < 1).toBe(true); }
  });
});

describe("generateApplications", () => {
  it("is deterministic for a seed and differs for another", () => {
    expect(gen(5, 100)).toEqual(gen(5, 100));
    expect(gen(6, 100)).not.toEqual(gen(5, 100));
  });
  it("gives every column type a value that passes parseCell, with options from their own column", () => {
    const rows = gen();
    const seen = new Set<string>();
    for (const r of rows) for (const [id, raw] of Object.entries(r.cells)) {
      const c = COLS.find((x) => x.id === Number(id))!;
      const p = parseCell(c.type, raw);
      expect(p.ok && p.value === raw, `${c.name}: ${JSON.stringify(raw)}`).toBe(true);
      if (c.type === "single_select") expect(c.options.map((o) => o.id)).toContain(raw);
      seen.add(c.type);
    }
    expect([...seen].sort()).toEqual(["checkbox", "date", "link", "number", "single_select", "text"]);
  });
  it("covers every status x priority pair and always sets the status", () => {
    const pairs = new Set(gen().filter((r) => r.cells[4] !== undefined).map((r) => `${r.cells[1]}-${r.cells[4]}`)); // priority may be blank outside the coverage pass
    expect(pairs.size).toBe(12);
    expect(gen().every((r) => r.cells[1] !== undefined)).toBe(true);
  });
  it("hits all 12 status x priority pairs with exactly 12 rows (the coverage pass, not luck)", () => {
    expect(new Set(gen(1, 12).map((r) => `${r.cells[1]}-${r.cells[4]}`)).size).toBe(12);
  });
  it("leaves a realistic share of the optional cells blank, and ~5% archived", () => {
    const rows = gen();
    const optional = [5, 6, 7, 8, 9, 10, 11, 12];
    const blank = rows.flatMap((r) => optional.filter((id) => r.cells[id] === undefined)).length / (rows.length * optional.length);
    expect(blank).toBeGreaterThan(0.1);
    expect(blank).toBeLessThan(0.4);
    const archived = rows.filter((r) => r.archived).length / rows.length;
    expect(archived).toBeGreaterThan(0.02);
    expect(archived).toBeLessThan(0.09);
  });
  it("spreads deadlines +-6 months of the base and uses example.com links only", () => {
    const base = Date.parse("2026-11-07T00:00:00Z");
    for (const r of gen()) {
      if (r.cells[5]) expect(Math.abs(Date.parse(String(r.cells[5]) + "T00:00:00Z") - base) / 86_400_000).toBeLessThanOrEqual(183);
      if (r.cells[7]) expect(String(r.cells[7])).toMatch(/^https:\/\/example\.com\//);
    }
  });
  it("builds unique-enough titles and includes the known company names", () => {
    const rows = gen(1, 400);
    expect(new Set(rows.map((r) => String(r.cells[2]))).size).toBe(400);
    for (const k of KNOWN_COMPANIES) expect(rows.some((r) => r.title.startsWith(k))).toBe(true);
    expect(rows[0].title).toBe(`${rows[0].cells[2]} - ${rows[0].cells[3]}`);
  });
  it("gives 100 PhD rows 100 distinct universities, each known one exactly once", () => {
    const phd = [col(1, "University", "text"), col(2, "Program", "text")];
    const unis = gen(1, 100, phd).map((r) => String(r.cells[1]));
    expect(new Set(unis).size).toBe(100);
    for (const k of KNOWN_UNIVERSITIES) {
      const place = k.split(" ").find((w) => !["University", "of", "Institute", "Technology"].includes(w))!;
      expect(unis.filter((u) => u.includes(place))).toEqual([k]); // a search by place finds just the one
    }
  });
  it("copes with a track with no status, no priority and no options", () => {
    const rows = gen(1, 20, [col(1, "Anything", "text"), col(2, "Empty", "single_select")]);
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.title && r.cells[2] === undefined)).toBe(true);
  });
});
