import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node tool, not part of the Next.js app (own module resolution).
    "watchdog/**",
    // Vendored game engine, ported as-is (LUL-13): not app source, not refactored.
    "public/**",
  ]),
  {
    // Playwright specs (LUL-21): they reach into page.evaluate()'s browser
    // globals -- window.ForestEngine, window.THREE, ad hoc QA instrumentation --
    // which aren't part of lib.dom.d.ts, so `any` is the honest type there, not
    // laziness. This is QA harness code, not shipped app source.
    files: ["e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
