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
  ]),
  {
    // LUL-621: engine/forest-engine.js is ported as-is from the prototype
    // (LUL-13) and still in its original style -- bringing 3,000+ lines of
    // prototype JS up to the app's full style ruleset is its own migration,
    // not part of this ticket, and stays deliberate, visible debt. But
    // LUL-427 (duplicate `let difficulty`, caught only because duplicate
    // `let` is a hard build error) and LUL-391 (duplicate `function
    // toggleHidden`, which is *legal* JS and silently shadowed a telemetry
    // call for who knows how long) are the same defect class recurring, and
    // a unit test structurally cannot catch a shadowed declaration -- the
    // test just imports whichever copy the parser kept. Only static
    // analysis catches this class, so this file gets the correctness rules
    // -- and only the correctness rules -- turned on, instead of staying
    // fully ignored.
    files: ["engine/**"],
    rules: {
      // --- Correctness rules this ticket turns ON. These catch dead/
      // shadowed/duplicate code, the exact bug class LUL-391 and LUL-427
      // both were. ---
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",

      // --- Style rules turned back OFF below. Verified empirically, not
      // preemptively: ran the file through the full eslint-config-next
      // preset with none of these correctness rules added, and only this
      // one rule actually fired (4 warnings -- unused locals/params left
      // over from the prototype, e.g. an unused catch-block binding).
      // Nothing else in the next/core-web-vitals or next/typescript
      // presets produced any diagnostic on this file, so there is nothing
      // else here to silence -- nothing is turned off "just in case". ---
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
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
