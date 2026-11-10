import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Every rename goes through this wrapper; the Nth one can be made to fail.
const hook = vi.hoisted(() => ({ n: 0, failOn: 0 }));
vi.mock("node:fs/promises", async (orig) => {
  const m = await orig<typeof import("node:fs/promises")>();
  return { ...m, rename: async (a: string, b: string) => { if (++hook.n === hook.failOn) throw new Error("rename failed"); return m.rename(a, b); } };
});

import { swapFiles } from "@/lib/files/restore";

let dir: string, root: string, stage: string;
beforeEach(() => {
  hook.n = 0;
  hook.failOn = 0;
  dir = mkdtempSync(join(tmpdir(), "dossier-swap-"));
  root = join(dir, "root");
  stage = join(root, ".dossier-restore-test");
  mkdirSync(join(root, "old-folder"), { recursive: true });
  writeFileSync(join(root, "old.txt"), "old");
  writeFileSync(join(root, "old-folder", "inner.txt"), "inner");
  mkdirSync(stage);
  writeFileSync(join(stage, "new1.txt"), "n1");
  writeFileSync(join(stage, "new2.txt"), "n2");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ls = (d: string) => readdirSync(d).sort();

it("swaps the contents: the new files are in, the old ones are aside until discard", async () => {
  const s = await swapFiles(root, stage);
  expect(ls(root).filter((n) => !n.startsWith(".dossier-restore"))).toEqual(["new1.txt", "new2.txt"]);
  expect(ls(s.aside)).toEqual(["old-folder", "old.txt"]);
  await s.discard();
  expect(ls(root)).toEqual([".dossier-restore-test", "new1.txt", "new2.txt"]);
});

it("undo puts the old contents back and the new ones back in staging", async () => {
  const s = await swapFiles(root, stage);
  await s.undo();
  expect(ls(root)).toEqual([".dossier-restore-test", "old-folder", "old.txt"]); // the emptied aside folder is removed
  expect(ls(stage)).toEqual(["new1.txt", "new2.txt"]);
});

// renames: 1 = old.txt or old-folder aside, 2 = the other, 3 = new1 in, 4 = new2 in
it.each([2, 4])("a failure at rename %i rolls the files folder back to what it was", async (failOn) => {
  hook.failOn = failOn;
  await expect(swapFiles(root, stage)).rejects.toThrow("rename failed");
  expect(ls(root)).toEqual([".dossier-restore-test", "old-folder", "old.txt"]);
  expect(ls(join(root, "old-folder"))).toEqual(["inner.txt"]);
  expect(ls(stage)).toEqual(["new1.txt", "new2.txt"]);
});
