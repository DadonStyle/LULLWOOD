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
    "public/**",
    // The game engine, ported as-is from the prototype (LUL-13) and still in its
    // original style. LUL-28 moved it out of public/ and made it a bundled
    // module, so it is real app source now and no longer covered by `public/**`
    // -- but bringing 1,200 lines of prototype JS up to the app's lint rules is
    // its own migration, not part of the module conversion. Ignored explicitly
    // so that stays visible, deliberate debt instead of an accident.
    "engine/**",
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
