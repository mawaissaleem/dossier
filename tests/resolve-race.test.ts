// resolveInRoot when realpath fails on a target that is there by the time lstat looks: a concurrent upload created that name in
// between (seen on Windows CI as "That file path is not allowed." for 2 of 8 concurrent uploads), or Windows failed realpath on a
// busy file. A plain entry must resolve; a symlink, or an entry that cannot be checked, must still be refused.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveInRoot } from "@/lib/files/resolve";

const hooks = vi.hoisted(() => ({
  realpathFails: null as null | { path: string; code: string },
  lstat: null as null | { path: string; result: "symlink" | { code: string } },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const err = (code: string) => Object.assign(new Error(code), { code });
  return {
    ...real,
    realpath: (p: string) => (hooks.realpathFails?.path === p ? Promise.reject(err(hooks.realpathFails.code)) : real.realpath(p)),
    lstat: async (p: string) => {
      const h = hooks.lstat?.path === p ? hooks.lstat.result : null;
      if (h && h !== "symlink") throw err(h.code);
      const s = await real.lstat(p);
      return h === "symlink" ? Object.assign(s, { isSymbolicLink: () => true }) : s;
    },
  };
});

let root: string, target: string;
beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "dossier-race-")));
  mkdirSync(join(root, "Acme"));
  target = join(root, "Acme", "02-20261108-CV.pdf");
  writeFileSync(target, "taken a moment ago");
});
afterEach(() => {
  hooks.realpathFails = null;
  hooks.lstat = null;
  rmSync(root, { recursive: true, force: true });
});

describe("resolveInRoot: realpath fails but the entry exists", () => {
  it.each(["ENOENT", "EPERM", "EBUSY"])("resolves a plain file when realpath fails with %s", async (code) => {
    hooks.realpathFails = { path: target, code };
    expect(await resolveInRoot(root, "Acme/02-20261108-CV.pdf")).toEqual({ ok: true, path: target });
  });
  it("resolves a plain folder the same way", async () => {
    hooks.realpathFails = { path: join(root, "Acme"), code: "ENOENT" };
    expect(await resolveInRoot(root, "Acme/new.pdf")).toEqual({ ok: true, path: join(root, "Acme", "new.pdf") });
  });
  it("still refuses when the entry is a symlink (dangling or looping)", async () => {
    hooks.realpathFails = { path: target, code: "ENOENT" };
    hooks.lstat = { path: target, result: "symlink" };
    expect((await resolveInRoot(root, "Acme/02-20261108-CV.pdf")).ok).toBe(false);
  });
  it("still refuses when the entry cannot be checked", async () => {
    hooks.realpathFails = { path: target, code: "EPERM" };
    hooks.lstat = { path: target, result: { code: "EPERM" } };
    expect((await resolveInRoot(root, "Acme/02-20261108-CV.pdf")).ok).toBe(false);
  });
});
