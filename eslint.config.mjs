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
    ".twenty-reference/**",
    "agent-lead2-inbox/**",
    "evo-lead-agent/**",
    "evo_website/**",
    "twenty-evo-admissions-app/**",
    "output/**",
    // Immutable Claude Design export kept as documentation, not runtime code.
    "docs/design/evo-platform/prototype/**",
  ]),
]);

export default eslintConfig;
