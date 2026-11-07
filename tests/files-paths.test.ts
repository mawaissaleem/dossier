import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRelativePath, isFullyAbsolute, toRelativePath } from "@/lib/files/relative";
import { resolveInRoot } from "@/lib/files/resolve";

describe("checkRelativePath (pure)", () => {
  it.each(["a.pdf", "Jobs/acme/cv v2.pdf", "a/b/c.txt", "%2e%2e/x", "..a/b", "a..b"])("accepts %s", (p) => {
    expect(checkRelativePath(p)).toEqual({ ok: true, path: p });
  });

  it.each([
    ["empty", ""], ["not a string", 5], ["undefined", undefined],
    ["parent first", "../x"], ["parent middle", "a/../../x"], ["parent last", "a/.."], ["bare parent", ".."], ["parent inside", "a/../b"],
    ["absolute", "/etc/passwd"], ["dot", "."], ["dot segment", "./a"], ["dot middle", "a/./b"],
    ["empty segment", "a//b"], ["trailing slash", "a/"],
    ["drive", "C:\\x"], ["drive relative", "C:x"], ["drive slash", "C:/x"], ["UNC", "\\\\server\\share"], ["backslash traversal", "a\\..\\x"], ["backslash", "a\\b"],
    ["NUL", "a\0b"], ["trailing dot (Windows reads ... as ..)", "a/.../x"], ["trailing space (Windows reads '.. ' as ..)", "a/.. /x"], ["trailing space name", "a /x"],
    ["too long", "a".repeat(5000)],
  ])("rejects %s", (_n, p) => {
    expect(checkRelativePath(p).ok).toBe(false);
  });

  it("catches a decoded percent-encoded traversal (decoding is the caller's job)", () => {
    expect(checkRelativePath(decodeURIComponent("%2e%2e/x")).ok).toBe(false);
    expect(checkRelativePath(decodeURIComponent("a%2F..%2F..%2Fx")).ok).toBe(false);
  });
});

describe("isFullyAbsolute", () => {
  it("on Windows requires a drive or UNC prefix", () => {
    expect(isFullyAbsolute("C:\\Users\\me", path.win32)).toBe(true);
    expect(isFullyAbsolute("c:/Users/me", path.win32)).toBe(true);
    expect(isFullyAbsolute("\\\\server\\share\\d", path.win32)).toBe(true);
    expect(isFullyAbsolute("\\foo", path.win32)).toBe(false);
    expect(isFullyAbsolute("/foo", path.win32)).toBe(false);
    expect(isFullyAbsolute("C:foo", path.win32)).toBe(false);
  });
  it("on POSIX is plain isAbsolute", () => {
    expect(isFullyAbsolute("/home/me", path.posix)).toBe(true);
    expect(isFullyAbsolute("home/me", path.posix)).toBe(false);
  });
});

let base: string, root: string, outside: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dossier-paths-"));
  root = join(base, "root");
  outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "x");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("toRelativePath", () => {
  it("turns an absolute path in the root into the stored form", () => {
    expect(toRelativePath(root, join(root, "a", "b.pdf"))).toEqual({ ok: true, path: "a/b.pdf" });
    expect(toRelativePath(root + "/", join(root, "x.pdf"))).toEqual({ ok: true, path: "x.pdf" });
  });
  it("rejects the root itself and anything outside", () => {
    expect(toRelativePath(root, root).ok).toBe(false);
    expect(toRelativePath(root, outside).ok).toBe(false);
    expect(toRelativePath(root, join(root, "..", "root-sibling", "x")).ok).toBe(false);
    expect(toRelativePath(root, join(root, "..", "x")).ok).toBe(false);
  });
});

describe("resolveInRoot", () => {
  it("returns the absolute path for an existing file and for one not created yet", async () => {
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "a", "f.txt"), "x");
    expect(await resolveInRoot(root, "a/f.txt")).toEqual({ ok: true, path: join(root, "a", "f.txt") });
    expect(await resolveInRoot(root, "new/deep/f.txt")).toEqual({ ok: true, path: join(root, "new", "deep", "f.txt") });
  });

  it.each(["../outside/secret.txt", "a/../../outside/secret.txt", "a/..", "..", "/etc/passwd", "", "a\\..\\x", "C:\\x", "a\0b"])("fails safely on %j", async (p) => {
    const r = await resolveInRoot(root, p);
    expect(r.ok).toBe(false);
  });

  it("never throws on odd input", async () => {
    for (const bad of [null, undefined, 1, {}, []]) expect((await resolveInRoot(root, bad)).ok).toBe(false);
    expect((await resolveInRoot("relative/root", "a.txt")).ok).toBe(false);
    expect((await resolveInRoot(join(base, "missing"), "a.txt")).ok).toBe(false);
    expect((await resolveInRoot(null as unknown as string, "a.txt")).ok).toBe(false);
  });

  it("refuses a symlinked file or folder pointing outside the root", async () => {
    symlinkSync(outside, join(root, "link"));
    symlinkSync(join(outside, "secret.txt"), join(root, "file-link"));
    expect((await resolveInRoot(root, "link/secret.txt")).ok).toBe(false);
    expect((await resolveInRoot(root, "link/new.txt")).ok).toBe(false); // write through a folder link
    expect((await resolveInRoot(root, "link/deep/new.txt")).ok).toBe(false);
    expect((await resolveInRoot(root, "file-link")).ok).toBe(false);
  });

  it("refuses a dangling symlink (its target would be created outside the root)", async () => {
    symlinkSync(join(outside, "not-yet.txt"), join(root, "dangling"));
    expect((await resolveInRoot(root, "dangling")).ok).toBe(false);
    symlinkSync(join(outside, "gone"), join(root, "dangling-dir"));
    expect((await resolveInRoot(root, "dangling-dir/f.txt")).ok).toBe(false);
  });

  it("refuses a symlink loop", async () => {
    symlinkSync(join(root, "loop"), join(root, "loop"));
    expect((await resolveInRoot(root, "loop")).ok).toBe(false);
  });

  it("allows a symlink that stays inside the root", async () => {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"));
    expect((await resolveInRoot(root, "alias/f.txt")).ok).toBe(true);
  });

  it("works when the root itself is a symlink", async () => {
    const alias = join(base, "root-alias");
    symlinkSync(root, alias);
    expect(await resolveInRoot(alias, "f.txt")).toEqual({ ok: true, path: join(alias, "f.txt") });
  });

  it("refuses the project folder and data/ when the root contains the app", async () => {
    const parent = join(process.cwd(), "..");
    const proj = path.basename(process.cwd());
    expect((await resolveInRoot(parent, `${proj}/package.json`)).ok).toBe(false);
    expect((await resolveInRoot(parent, `${proj}/data/dossier.db`)).ok).toBe(false);
    expect((await resolveInRoot(parent, "other-folder/f.txt")).ok).toBe(true);
  });
});
