import { describe, expect, it } from "vitest";
import { checkListing, entryKind, parseExpected, schemaIsNewer, type Limits, type ZipEntryInfo } from "@/lib/restore";

const e = (name: string, over: Partial<ZipEntryInfo> = {}): ZipEntryInfo => ({ name, flags: 0x800, method: 8, compressedSize: 5, uncompressedSize: 10, versionMadeBy: 3 << 8 | 20, externalAttributes: (0o100644 << 16) >>> 0, ...over });
const good = [e("manifest.json"), e("database/dossier.db"), e("files/Acme/cv.pdf"), e("files/top.txt")];
const err = (entries: ZipEntryInfo[], limits?: Limits) => {
  const r = checkListing(entries, limits);
  return r.ok ? null : r.error;
};

describe("entryKind", () => {
  it("reads the Unix mode, the DOS directory bit and the trailing slash", () => {
    const attrs = (mode: number) => (mode << 16) >>> 0;
    expect(entryKind({ name: "a", versionMadeBy: 3 << 8, externalAttributes: attrs(0o100444) })).toBe("file");
    expect(entryKind({ name: "a", versionMadeBy: 3 << 8, externalAttributes: attrs(0o120777) })).toBe("symlink");
    expect(entryKind({ name: "a", versionMadeBy: 3 << 8, externalAttributes: attrs(0o060000) })).toBe("other");
    expect(entryKind({ name: "a/", versionMadeBy: 3 << 8, externalAttributes: attrs(0o040755) })).toBe("dir");
    expect(entryKind({ name: "a/", versionMadeBy: 0, externalAttributes: 0 })).toBe("dir");
    expect(entryKind({ name: "a", versionMadeBy: 0, externalAttributes: 0x10 })).toBe("dir");
    expect(entryKind({ name: "a", versionMadeBy: 0, externalAttributes: 0 })).toBe("file");
  });
});

describe("checkListing", () => {
  it("accepts a normal backup and lists the files and sizes", () => {
    const r = checkListing(good);
    expect(r).toMatchObject({ ok: true, dbBytes: 10, totalBytes: 40 });
    expect(r.ok && [...r.files.keys()]).toEqual(["Acme/cv.pdf", "top.txt"]);
  });

  it("allows empty folder entries under files/ and database/", () => {
    const dir = (n: string) => e(n, { uncompressedSize: 0, compressedSize: 0, externalAttributes: (0o040755 << 16) >>> 0 });
    expect(err([...good, dir("files/"), dir("database/"), dir("files/Acme/")])).toBeNull();
    expect(err([...good, e("files/Acme/", { externalAttributes: (0o040755 << 16) >>> 0 })])).toMatch(/folder entry with data/);
  });

  it.each([
    ["a .. segment (zip-slip)", "files/../evil.txt", /outside its own folder/],
    ["a leading .. segment", "../evil.txt", /outside its own folder/],
    ["an absolute path", "/etc/passwd", /outside its own folder/],
    ["a drive letter", "C:/x.txt", /outside its own folder/],
    ["a drive letter under files", "files/C:/x.txt", /unsafe name/],
    ["a backslash", "files\\evil.txt", /unsafe name/],
    ["a NUL", "files/a\0b.txt", /unsafe name/],
    ["a . segment", "files/./a.txt", /outside its own folder/],
    ["an empty segment", "files//a.txt", /outside its own folder/],
    ["a trailing dot", "files/a./b.txt", /unsafe name/],
    ["an unexpected top-level entry", "evil.sh", /unexpected entry/],
    ["an unexpected database entry", "database/other.db", /unexpected entry/],
  ])("refuses %s", (_label, name, re) => {
    expect(err([...good, e(name)])).toMatch(re);
  });

  it("refuses duplicates, links, special types and encrypted or unusual entries", () => {
    expect(err([...good, e("files/top.txt")])).toMatch(/twice/);
    expect(err([...good, e("files/link", { externalAttributes: (0o120777 << 16) >>> 0 })])).toMatch(/link or special/);
    expect(err([...good, e("files/fifo", { externalAttributes: (0o010644 << 16) >>> 0 })])).toMatch(/link or special/);
    expect(err([...good, e("files/enc.bin", { flags: 0x801 })])).toMatch(/encrypted/);
    expect(err([...good, e("files/odd.bin", { method: 12 })])).toMatch(/compression method/);
  });

  it("refuses a file that is also a folder", () => {
    expect(err([...good, e("files/top.txt/inner.txt")])).toMatch(/both a file and a folder/);
  });

  it("needs the manifest and the database", () => {
    expect(err(good.slice(1))).toMatch(/no manifest/);
    expect(err([good[0], ...good.slice(2)])).toMatch(/no database/);
  });

  it("applies the zip-bomb limits: entries, total size, ratio, manifest size", () => {
    const small: Limits = { maxEntries: 3, maxTotalBytes: 1000, maxRatio: 10, ratioFloorBytes: 100, maxManifestBytes: 50 };
    expect(err(good, small)).toMatch(/too many entries/);
    const base = [e("manifest.json", { uncompressedSize: 10 }), e("database/dossier.db", { uncompressedSize: 10 })];
    expect(err([...base, e("files/big", { uncompressedSize: 5000, compressedSize: 5000 })], { ...small, maxEntries: 10 })).toMatch(/unpack to more than/);
    expect(err([...base, e("files/bomb", { uncompressedSize: 500, compressedSize: 2 })], { ...small, maxEntries: 10 })).toMatch(/zip bomb/);
    expect(err([...base, e("files/tiny", { uncompressedSize: 90, compressedSize: 1 })], { ...small, maxEntries: 10 })).toBeNull(); // under the floor
    expect(err([e("manifest.json", { uncompressedSize: 60 }), base[1]], { ...small, maxEntries: 10 })).toMatch(/manifest is too large/);
  });
});

describe("small helpers", () => {
  it("schemaIsNewer: only a backup ahead of the app is refused", () => {
    expect(schemaIsNewer(200, 100)).toBe(true);
    expect(schemaIsNewer(100, 100)).toBe(false);
    expect(schemaIsNewer(50, 100)).toBe(false);
    expect(schemaIsNewer(null, 100)).toBe(false);
    expect(schemaIsNewer(5, null)).toBe(true);
  });

  it("parseExpected takes only a date and five counts", () => {
    const counts = { applications: 1, columns: 2, files: 3, submissions: 4, notes: 5 };
    expect(parseExpected({ createdAt: "x", counts })).toEqual({ createdAt: "x", counts });
    for (const bad of [null, "x", {}, { createdAt: 1, counts }, { createdAt: "x", counts: { ...counts, notes: -1 } }, { createdAt: "x", counts: { ...counts, files: "3" } }, { createdAt: "x" }]) {
      expect(parseExpected(bad)).toBeNull();
    }
  });
});
