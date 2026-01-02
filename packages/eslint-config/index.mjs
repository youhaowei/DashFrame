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

const sharedConfig = [
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  prettierConfig,
  {
    rules: sharedRules,
  },
  // Relaxed rules for test files - test nesting (describe/it/expect) commonly exceeds 4 levels
  // See: https://community.sonarsource.com/t/s2004-sonarjs-no-nested-functions-triggers-in-describe-it-test-files/131292
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "sonarjs/no-nested-functions": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "apps/web/next-env.d.ts",
    ],
  },
];

export default sharedConfig;
