import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// NFR-10: Next defaults to 0.0.0.0 when -H is absent, so a dropped flag would silently expose the app on the LAN.
const scripts: Record<string, string> = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).scripts;

describe("server scripts bind to loopback explicitly (NFR-10)", () => {
  for (const name of ["dev", "start"]) {
    it(`${name} passes -H 127.0.0.1`, () => {
      expect(scripts[name]).toMatch(/(^|\s)(-H|--hostname)[ =]127\.0\.0\.1(\s|$)/);
    });
  }
});
