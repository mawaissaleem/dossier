import { describe, expect, it } from "vitest";
import { folderBaseName, uniqueFolderName, type FolderNameInput } from "@/lib/folder-name";
import { safeName } from "@/lib/safe-name";

describe("safeName", () => {
  it.each([
    ["Acme Corp", "Acme_Corp"],
    ['a<b>c:d"e/f\\g|h?i*j', "a_b_c_d_e_f_g_h_i_j"],
    ["a\u0000b\tc\nd\u007fe", "a_b_c_d_e"],
    ["  ..__Acme   Corp__..  ", "Acme_Corp"],
    ["a - - b", "a_-_-_b"],
    ["Zürich Universität", "Zürich_Universität"],
    ["東京大学 工学部", "東京大学_工学部"],
    ["CON", "CON_"], ["nul", "nul_"], ["Com1", "Com1_"], ["LPT9.txt", "LPT9_.txt"], ["aux.tar.gz", "aux_.tar.gz"],
    ["CON_x", "CON_x"], ["COM10", "COM10"], ["console", "console"],
  ])("%j -> %j", (input, out) => expect(safeName(input, "fb")).toBe(out));

  it("uses the fallback when nothing is left", () => {
    for (const s of ["", "   ", "???", "...", "___", "\u0000"]) expect(safeName(s, "fb")).toBe("fb");
  });
  it("caps the length (by characters, not splitting surrogate pairs) and re-trims", () => {
    expect(safeName("a".repeat(200), "fb")).toHaveLength(80);
    expect(safeName("a".repeat(5) + " b", "fb", 6)).toBe("aaaaa");
    const s = safeName("😀".repeat(100), "fb", 10);
    expect(Array.from(s)).toHaveLength(10);
  });
  it("caps UTF-8 bytes too, cutting whole code points", () => {
    const s = safeName("😀".repeat(100), "fb");
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(200);
    expect(s).toBe("😀".repeat(50));
    expect(safeName("é".repeat(5), "fb", 80, 5)).toBe("éé");
  });
  it("makes NFC and NFD the same", () => expect(safeName("Zürich", "fb")).toBe(safeName("Zürich", "fb")));
});

const cell = (name: string, value: string | null) => ({ name, value });
const base = (o: Partial<FolderNameInput> = {}): FolderNameInput => ({
  id: 7, title: "My app", trackName: "Job", uploadDate: "2026-10-15",
  cells: [cell("Company", "Acme Corp"), cell("Role", "Data Engineer"), cell("Location", "Berlin")], ...o,
});

describe("folderBaseName", () => {
  it("Job: Company_Role_YYYY-MM from the upload date", () => {
    expect(folderBaseName(base())).toBe("Acme_Corp_Data_Engineer_2026-10");
    expect(folderBaseName(base({ uploadDate: "2027-01-02" }))).toBe("Acme_Corp_Data_Engineer_2027-01");
  });
  it("PhD: University_Program, columns matched by trimmed case-insensitive name", () => {
    const r = folderBaseName(base({ trackName: " phd ", cells: [cell(" UNIVERSITY", "Zürich"), cell("program", "Computer Science")] }));
    expect(r).toBe("Zürich_Computer_Science_2026-10");
  });
  it("another track falls back to the title, even with a Company column", () => {
    expect(folderBaseName(base({ trackName: "Grants" }))).toBe("My_app_2026-10");
  });
  it("a blank or missing identifying value falls back to the title", () => {
    expect(folderBaseName(base({ cells: [cell("Company", "Acme"), cell("Role", "  ")] }))).toBe("My_app_2026-10");
    expect(folderBaseName(base({ cells: [cell("Company", "Acme"), cell("Role", null)] }))).toBe("My_app_2026-10");
    expect(folderBaseName(base({ cells: [cell("Company", "Acme")] }))).toBe("My_app_2026-10");
    expect(folderBaseName(base({ cells: [cell("Company", "???"), cell("Role", "Dev")] }))).toBe("My_app_2026-10");
  });
  it("a blank title falls back to Application_<id>", () => {
    expect(folderBaseName(base({ trackName: "X", title: " // " }))).toBe("Application_7_2026-10");
  });
  it("strips illegal characters and device names", () => {
    expect(folderBaseName(base({ cells: [cell("Company", "A/B: C"), cell("Role", "D*E")] }))).toBe("A_B_C_D_E_2026-10");
    expect(folderBaseName(base({ trackName: "X", title: "CON" }))).toBe("CON__2026-10");
  });
  it("long names keep the whole folder name within 80 characters", () => {
    const r = folderBaseName(base({ cells: [cell("Company", "C".repeat(100)), cell("Role", "R")] }));
    expect(r.length).toBeLessThanOrEqual(80);
    expect(r.endsWith("_2026-10")).toBe(true);
  });
  it("keeps the whole name within 255 UTF-8 bytes, with room for a _NNN suffix", () => {
    const r = folderBaseName(base({ trackName: "X", title: "😀".repeat(100) }));
    expect(Buffer.byteLength(`${r}_999`)).toBeLessThanOrEqual(255);
    expect(r.endsWith("_2026-10")).toBe(true);
    const job = folderBaseName(base({ cells: [cell("Company", "😀".repeat(100)), cell("Role", "R")] }));
    expect(Buffer.byteLength(job)).toBeLessThanOrEqual(200);
  });
  it("rejects a malformed or impossible date", () => {
    for (const d of ["", "2026-10", "2026-13-01", "2026-02-30", " 2026-10-01"]) expect(() => folderBaseName(base({ uploadDate: d }))).toThrow();
    expect(folderBaseName(base({ uploadDate: "2028-02-29" }))).toBe("Acme_Corp_Data_Engineer_2028-02");
  });
});

describe("uniqueFolderName", () => {
  it("returns the name when free, else the first free _n", () => {
    expect(uniqueFolderName("A_2026-10", [])).toBe("A_2026-10");
    expect(uniqueFolderName("A_2026-10", ["A_2026-10"])).toBe("A_2026-10_2");
    expect(uniqueFolderName("A_2026-10", ["A_2026-10", "A_2026-10_2"])).toBe("A_2026-10_3");
  });
  it("compares case-insensitively", () => {
    expect(uniqueFolderName("Acme_2026-10", ["ACME_2026-10"])).toBe("Acme_2026-10_2");
    expect(uniqueFolderName("Zürich", ["zürich"])).toBe("Zürich_2");
  });
});
