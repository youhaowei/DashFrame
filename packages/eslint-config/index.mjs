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

// Non-command `no-restricted-imports` entries that should apply everywhere,
// including inside apps/server — currently empty, but the seam future
// restricted-import entries should be added to. Keeping them here (rather
// than folded directly into commandBoundaryRules below) means the
// apps/server override further down can drop just the command-specific
// entries while still inheriting whatever lands in this list.
const baseRestrictedImportPaths = [];
const baseRestrictedImportPatterns = [];

// The raw wystack command envelope (`Command`, from `@wystack/server`) and
// DashFrame's command-builder module (apps/server/src/functions/commands.ts)
// are the ONLY two things that should ever construct a `{ path, args }`
// command literal by hand. Everywhere else — app code, connectors, the
// renderer — must go through the typed `cmd()` builder / the server's RPC
// surface instead of importing the raw shape and hand-assembling one. This
// rule enforces that at the import boundary; the `apps/server/**` override
// below re-specifies the rule with just the command-specific entries
// dropped, so any future entry added to baseRestrictedImportPaths/Patterns
// above still applies inside the server too.
const commandBoundaryPaths = [
  {
    name: "@wystack/server",
    message:
      "@wystack/server's raw command types (e.g. Command) are server-internal. " +
      "Build commands via cmd()/CommandPayloads in apps/server/src/functions/commands.ts, " +
      "or call the server's RPC surface — don't hand-assemble a { path, args } literal.",
  },
];
const commandBoundaryPatterns = [
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
];

const commandBoundaryRules = {
  "no-restricted-imports": [
    "error",
    {
      paths: [...baseRestrictedImportPaths, ...commandBoundaryPaths],
      patterns: [...baseRestrictedImportPatterns, ...commandBoundaryPatterns],
    },
  ],
};

// Same rule, command-specific entries dropped — used by the apps/server
// override below so the server (the builder layer itself) isn't blocked
// from touching the raw command shape, while still picking up any
// non-command restricted-import entry added to the base lists above.
const serverRestrictedImportRules = {
  "no-restricted-imports": [
    "error",
    {
      paths: [...baseRestrictedImportPaths],
      patterns: [...baseRestrictedImportPatterns],
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
  // generally are exempt from the command-specific restrictions — they're
  // the only code allowed to touch the raw command shape. Re-specify the
  // rule with just those entries dropped (see serverRestrictedImportRules
  // above) rather than turning the rule off outright, so a future non-command
  // restricted-import entry still applies inside the server too.
  {
    files: ["apps/server/**/*.ts", "apps/server/**/*.tsx"],
    rules: serverRestrictedImportRules,
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
