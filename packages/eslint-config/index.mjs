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

// The raw wystack command envelope (`Command`, from `@wystack/server`) and
// DashFrame's command-builder module (apps/server/src/functions/commands.ts)
// are the ONLY two things that should ever construct a `{ path, args }`
// command literal by hand. Everywhere else — app code, connectors, the
// renderer — must go through the typed `cmd()` builder / the server's RPC
// surface instead of importing the raw shape and hand-assembling one. This
// rule enforces that at the import boundary; the `apps/server/**` override
// below lifts it for the server itself (the builder layer lives inside it).
const commandBoundaryRules = {
  "no-restricted-imports": [
    "error",
    {
      paths: [
        {
          name: "@wystack/server",
          message:
            "@wystack/server's raw command types (e.g. Command) are server-internal. " +
            "Build commands via cmd()/CommandPayloads in apps/server/src/functions/commands.ts, " +
            "or call the server's RPC surface — don't hand-assemble a { path, args } literal.",
        },
      ],
      patterns: [
        {
          group: [
            "**/functions/commands",
            "**/functions/commands.js",
            "**/functions/commands.ts",
          ],
          message:
            "apps/server/src/functions/commands.ts is the command builder layer — " +
            "importable only from within apps/server. Use the server's RPC/command API " +
            "instead of reaching into it directly.",
        },
      ],
    },
  ],
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
    rules: commandBoundaryRules,
  },
  // The builder layer (apps/server/src/functions/commands.ts) and the server
  // generally are exempt — they're the only code allowed to touch the raw
  // command shape.
  {
    files: ["apps/server/**/*.ts", "apps/server/**/*.tsx"],
    rules: {
      "no-restricted-imports": "off",
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
