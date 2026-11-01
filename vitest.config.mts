import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } }, // same as tsconfig paths "@/*"
  test: { environment: "node", include: ["tests/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"] },
});
