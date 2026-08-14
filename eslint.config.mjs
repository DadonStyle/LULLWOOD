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
]);

export default eslintConfig;
