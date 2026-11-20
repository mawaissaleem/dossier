import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier, // turns off ESLint rules that would fight Prettier's formatting
  {
    // Prettier wraps code but never comments: keep comment lines within the same 120 columns.
    rules: {
      "max-len": ["error", { code: 10000, comments: 120, ignorePattern: "^\\s*// eslint-disable", ignoreUrls: true }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent work files, including baseline snapshots of old code.
    ".claude/**",
  ]),
]);

export default eslintConfig;
