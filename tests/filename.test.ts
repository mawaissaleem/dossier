import { describe, expect, it } from "vitest";
import { buildStoredName, formatStoredName, nextSeq, safeExtension, splitOriginalName, todayLocal, type CounterEntry } from "@/lib/filename";

const D = "2026-11-08";
const E = (baseName: string, ext: string, seq: number, uploadDate = D): CounterEntry => ({ baseName, extension: ext, uploadDate, seq });
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("splitOriginalName", () => {
  it.each([
    ["CV.pdf", "CV", "pdf"],
    ["report.final.docx", "report.final", "docx"],
    ["README", "README", ""],
    [".env", ".env", ""],
    ["file.", "file", ""],
    ["C:\\docs\\CV.pdf", "CV", "pdf"],
    ["a/b/CV.pdf", "CV", "pdf"],
  ])("%s", (name, base, ext) => expect(splitOriginalName(name)).toEqual({ base, ext }));
});

describe("safeExtension", () => {
  it("lowercases and keeps safe characters only", () => {
    expect(safeExtension("PDF")).toBe("pdf");
    expect(safeExtension("p d*f")).toBe("pdf");
    expect(safeExtension("é")).toBe("");
    expect(safeExtension("a".repeat(40))).toHaveLength(16);
  });
});

describe("nextSeq (FR-6.1, 6.2)", () => {
  const t = { baseName: "CV", uploadDate: D, extension: "pdf" };
  it("starts at 1", () => expect(nextSeq([], t)).toBe(1));
  it("uses max+1, so a gap is not reused", () => expect(nextSeq([E("CV", "pdf", 1), E("CV", "pdf", 3)], t)).toBe(4));
  it("is per base name, date and extension", () => {
    expect(nextSeq([E("CV", "docx", 1), E("Cover", "pdf", 1), E("CV", "pdf", 1, "2026-11-07")], t)).toBe(1);
  });
  it("compares base and extension case-insensitively", () => expect(nextSeq([E("cv", "PDF", 2)], t)).toBe(3));
});

describe("formatStoredName (FR-6.5)", () => {
  it("pads to two digits, grows past 99", () => {
    expect(formatStoredName(1, D, "CV", "pdf")).toBe("01-20261108-CV.pdf");
    expect(formatStoredName(99, D, "CV", "pdf")).toBe("99-20261108-CV.pdf");
    expect(formatStoredName(100, D, "CV", "pdf")).toBe("100-20261108-CV.pdf");
  });
  it("omits the dot without an extension", () => expect(formatStoredName(1, D, "README", "")).toBe("01-20261108-README"));
});

describe("buildStoredName", () => {
  it("AT-5: CV.docx and CV.pdf are both 01; a changed CV.pdf the same day is 02", () => {
    const existing: CounterEntry[] = [];
    const add = (name: string) => {
      const r = buildStoredName(name, D, existing);
      existing.push(r);
      return r.storedName;
    };
    expect(add("CV.docx")).toBe("01-20261108-CV.docx");
    expect(add("CV.pdf")).toBe("01-20261108-CV.pdf");
    expect(add("CV.pdf")).toBe("02-20261108-CV.pdf");
  });
  it.each([
    ["CV.pdf", "CV.pdf."],
    ["CV.pdf", "CV.pdf.é"],
    ["CV.pdf", "CV.pdf.~"],
    ["a.b", "a.b.."],
    ["CV.pdf.", "CV.PDF"],
  ])("never gives %s and %s the same stored name (same rendered tail shares a counter)", (first, second) => {
    const a = buildStoredName(first, D, []);
    const b = buildStoredName(second, D, [a]);
    expect(b.storedName).not.toBe(a.storedName);
    expect(b.seq).toBe(2);
  });
  it("FR-6.1: a different day resets to 01", () => {
    expect(buildStoredName("CV.pdf", "2026-11-09", [E("CV", "pdf", 2)]).storedName).toBe("01-20261109-CV.pdf");
  });
  it("FR-6.2: CV.PDF and cv.pdf share a counter", () => {
    expect(buildStoredName("cv.pdf", D, [E("CV", "pdf", 1)]).storedName).toBe("02-20261108-cv.pdf");
  });
  it("FR-6.4: uses the given date and rejects an invalid one", () => {
    expect(buildStoredName("CV.pdf", "2026-02-28", []).storedName).toBe("01-20260228-CV.pdf");
    for (const bad of ["2026-02-30", "2026-13-01", "20261108", "", " 2026-11-08", "2026-11-08 "]) {
      expect(() => buildStoredName("CV.pdf", bad, [])).toThrow();
    }
  });
  it("FR-6.5: past 99 uploads the counter has three digits", () => {
    expect(buildStoredName("CV.pdf", D, [E("CV", "pdf", 99)]).storedName).toBe("100-20261108-CV.pdf");
  });
  it("FR-6.6: invalid characters are replaced, spaces become underscores", () => {
    const r = buildStoredName('My CV: "final"?.PDF', D, []);
    expect(r.storedName).toBe("01-20261108-My_CV_final.pdf");
    expect(r.baseName).toBe("My_CV_final");
  });
  it("FR-6.7: the original name is returned unchanged", () => {
    expect(buildStoredName('My CV: "final"?.PDF', D, []).originalName).toBe('My CV: "final"?.PDF');
  });
  it("handles no extension, dotfiles and trailing dots", () => {
    expect(buildStoredName("README", D, []).storedName).toBe("01-20261108-README");
    expect(buildStoredName(".env", D, []).storedName).toBe("01-20261108-env");
    expect(buildStoredName("file.", D, []).storedName).toBe("01-20261108-file");
    expect(buildStoredName("report.final.docx", D, []).storedName).toBe("01-20261108-report.final.docx");
  });
  it("makes device names and empty bases safe", () => {
    expect(buildStoredName("CON.pdf", D, []).storedName).toBe("01-20261108-CON_.pdf");
    expect(buildStoredName("COM\u00b9.pdf", D, []).baseName).toBe("COM\u00b9_");
    expect(buildStoredName("???.pdf", D, []).storedName).toBe("01-20261108-file.pdf");
    expect(buildStoredName(".pdf", D, []).storedName).toBe("01-20261108-pdf");
  });
  it("caps the name at 255 bytes, truncating only the base, with the same base for seq 99 and 100", () => {
    const name = `${"é".repeat(300)}.docx`;
    const a = buildStoredName(name, D, [E("x", "docx", 1)]);
    expect(bytes(a.storedName)).toBeLessThanOrEqual(255);
    expect(a.storedName.endsWith(".docx")).toBe(true);
    expect(a.storedName.startsWith("01-20261108-é")).toBe(true);
    const b = buildStoredName(name, D, [E(a.baseName, "docx", 99)]);
    expect(b.seq).toBe(100);
    expect(b.baseName).toBe(a.baseName);
    expect(bytes(b.storedName)).toBeLessThanOrEqual(255);
    const long = buildStoredName(`${"a".repeat(400)}.${"b".repeat(40)}`, D, [E("a".repeat(222), "b".repeat(16), 99)]);
    expect(bytes(long.storedName)).toBeLessThanOrEqual(255);
  });
  describe("FR-6.3 / AT-6: strips an existing prefix", () => {
    const name = (n: string, existing: CounterEntry[] = []) => buildStoredName(n, D, existing);
    it("03-20261001-CV.pdf becomes 01-20261108-CV.pdf and shares the CV/pdf counter", () => {
      const a = name("03-20261001-CV.pdf");
      expect(a.storedName).toBe("01-20261108-CV.pdf");
      expect(a.baseName).toBe("CV");
      expect(name("CV.pdf", [a]).storedName).toBe("02-20261108-CV.pdf");
      expect(name("03-20261001-CV.pdf", [a]).storedName).toBe("02-20261108-CV.pdf");
    });
    it("strips repeated prefixes, 3-digit counters and a prefix that sanitising exposes", () => {
      expect(name("01-20261001-02-20261002-CV.pdf").storedName).toBe("01-20261108-CV.pdf");
      expect(name("100-20261001-CV.pdf").storedName).toBe("01-20261108-CV.pdf");
      expect(name("01-20261001-_02-20261002-CV.pdf").storedName).toBe("01-20261108-CV.pdf");
      expect(name("_01-20261001-CV.pdf").storedName).toBe("01-20261108-CV.pdf");
      expect(name("01-20261001-CON.pdf").storedName).toBe("01-20261108-CON_.pdf");
      expect(name("01-20261001-README").storedName).toBe("01-20261108-README");
    });
    it("an empty remainder falls back to file", () => {
      expect(name("01-20261001-.pdf").storedName).toBe("01-20261108-file.pdf");
      expect(name("01-20261001-01-20261002-.pdf").storedName).toBe("01-20261108-file.pdf");
    });
    it.each(["2026-report.pdf", "1-20261001-x.pdf", "01-20261341-x.pdf", "01-2026100-x.pdf", "01-202610010-x.pdf", "01-20260230-x.pdf", "01-20261001x.pdf"])(
      "leaves %s alone",
      (n) => expect(name(n).baseName).toBe(n.slice(0, -4)),
    );
    it("01 20261001 CV.pdf is not a prefix: spaces become underscores", () => {
      expect(name("01 20261001 CV.pdf").storedName).toBe("01-20261108-01_20261001_CV.pdf");
    });
    it("keeps the original name unchanged", () => {
      expect(name("03-20261001-CV.pdf").originalName).toBe("03-20261001-CV.pdf");
    });
    it("a long base round-trips: its stored name and a prefixed form share the base and counter", () => {
      const first = name(`${"a".repeat(300)}.pdf`);
      expect(first.seq).toBe(1);
      const again = name(first.storedName, [first]);
      expect(again.baseName).toBe(first.baseName);
      expect(again.seq).toBe(2);
      const prefixed = name(`03-20261001-${"a".repeat(300)}.pdf`, [first]);
      expect(prefixed.baseName).toBe(first.baseName);
      expect(prefixed.seq).toBe(2);
    });
    it("AT-6: the stored name never holds two prefixes", () => {
      // Counts prefix-shaped runs; none of these inputs has one inside its real base.
      for (const n of ["01-20261108-CV.pdf", "01-20261001-02-20261002-CV.pdf", " 01-20261001-CV.pdf", "99-20260101-01-20260102-02-20260103-x.docx"]) {
        const stored = name(n).storedName;
        expect(stored.match(/(^|-)\d{2,}-\d{8}-/g)).toHaveLength(1);
      }
    });
  });
});

describe("todayLocal", () => {
  it("uses the local calendar date", () => {
    expect(todayLocal(new Date(2026, 10, 8, 23, 59))).toBe("2026-11-08");
    expect(todayLocal(new Date(2026, 0, 2, 0, 1))).toBe("2026-01-02");
  });
});
