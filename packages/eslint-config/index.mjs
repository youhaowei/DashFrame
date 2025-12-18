import { defineConfig, globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

const noUnusedVarsRule = [
  "warn",
  {
    ignoreRestSiblings: true,
    varsIgnorePattern: "^_",
    argsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
  },
];

export const sharedRules = {
  "@typescript-eslint/no-unused-vars": noUnusedVarsRule,
  // Allow TODO/FIXME comments - these track legitimate future work
  "sonarjs/todo-tag": "off",
  "sonarjs/fixme-tag": "off",
};

const sharedConfig = defineConfig([
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  prettierConfig,
  {
    rules: sharedRules,
  },
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
