import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Archived pre-Black-Box GuruFlow code. Not part of the Next.js build, so
    // `npm run lint` reports only the live ScanSite source. Its pre-existing
    // problems are listed in the implementation report.
    "legacy-guruflow/**",

    // Local Black Box JSON store.
    "data/**",
  ]),
  ...nextVitals,
]);

export default eslintConfig;
