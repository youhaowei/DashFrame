import { defineConfig, globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

const sharedConfig = defineConfig([
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
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

export default sharedConfig;
