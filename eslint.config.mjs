import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettierConfig,
  globalIgnores([
    "node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "apps/web/next-env.d.ts",
  ]),
]);

