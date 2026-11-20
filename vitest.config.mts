import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } }, // same as tsconfig paths "@/*"
  // 20 s: the slowest suites (rows-scale, planner-follow-ups, seed-fake, restore, relocate) flaked at the 5 s default
  // on a loaded CI runner; explicit timing assertions in tests are unaffected. Windows CI runners are several times
  // slower on file-heavy suites (antivirus scans every new file), so they get 60 s.
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 60_000 : 20_000,
    hookTimeout: process.platform === "win32" ? 60_000 : 20_000,
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
