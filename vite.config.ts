import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import storybook from "eslint-plugin-storybook";
import { defineConfig } from "vite-plus";

const reactHooksRules = Object.fromEntries(
  Object.entries(reactHooks.configs.flat.recommended.rules).map(
    ([name, severity]) => [
      name.replace("react-hooks/", "react-hooks-js/"),
      severity,
    ],
  ),
);
const nextRules = {
  ...next.configs.recommended.rules,
  ...next.configs["core-web-vitals"].rules,
};
const storybookRules = Object.assign(
  {},
  ...storybook.configs["flat/recommended"].map((config) => config.rules ?? {}),
);

export default defineConfig({
  lint: {
    // Native plugin set. Every plugin listed here contributes its whole
    // `correctness` bucket (see `categories` below); `import` and `promise`
    // catch structural mistakes (cycles, duplicate imports, mis-shaped
    // executors). The bucket rules that are style rather than correctness for
    // this repo are turned off by name in `rules`, each with its reason.
    plugins: [
      "oxc",
      "typescript",
      "react",
      "unicorn",
      "promise",
      "import",
      "vitest",
    ],
    jsPlugins: [
      "eslint-plugin-sonarjs",
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
      {
        name: "dashframe",
        specifier: "./scripts/oxlint-plugin-dashframe.mjs",
      },
      {
        name: "@next/next",
        specifier: "@next/eslint-plugin-next",
      },
      {
        name: "storybook",
        specifier: "eslint-plugin-storybook",
      },
      {
        name: "react-hooks-js",
        specifier: "eslint-plugin-react-hooks",
      },
    ],
    // Lint policy (see docs/audits/lint-guardrails-evaluation-2026-09-07.md):
    // oxlint's `correctness` category is on for every enabled plugin, and the
    // explicit rules below are the measured, near-zero-cost additions that
    // target sloppy generated code. Every rule here is `error` — warnings do
    // not fail the gate. The one warning left in the output on purpose is the
    // react-hooks-js `incompatible-library` note on TanStack Virtual in
    // VirtualTable.tsx, kept visible as a compiler-safety reminder.
    // Adding a rule means measuring it first; turning one off means writing
    // the reason next to it.
    categories: {
      correctness: "error",
    },
    env: {
      builtin: true,
    },
    settings: {
      react: {
        version: "999.999.999",
      },
    },
    ignorePatterns: [
      "node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "apps/web/next-env.d.ts",
      "apps/web/.next-e2e/**",
      "apps/renderer/src/routeTree.gen.ts",
      "apps/web/src/routeTree.gen.ts",
      "libs/**",
    ],
    rules: {
      // --- Native rules disabled on purpose ---------------------------------
      // The classic-runtime rule; every renderer here uses the automatic JSX
      // runtime, so `React` need not be in scope.
      "react/react-in-jsx-scope": "off",
      // The oxlint ports flag `.use(...)` methods on non-React objects; the
      // eslint-plugin-react-hooks rules (jsPlugin `react-hooks-js`, applied in
      // the overrides below) are the authoritative hook linters.
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      // Flags a value import next to an `import type` from the same module,
      // which verbatimModuleSyntax requires. `import/no-duplicates` below
      // catches genuine duplicates without that false positive.
      "no-duplicate-imports": "off",
      // `== null` is the sanctioned nullish check (eqeqeq below allows it).
      "no-eq-null": "off",
      // These ship in the vitest plugin's `correctness` bucket but are style
      // opinions for this codebase: typed mocks everywhere (630 sites),
      // `toThrow()` without a message (134), and `expect` inside conditionals
      // (51, mostly narrowing guards). `expect-expect` misreads
      // `screen.getByRole(...)` (which throws on failure) as an assertion-free
      // test; `sonarjs/assertions-in-tests` below covers that intent.
      "vitest/require-mock-type-parameters": "off",
      "vitest/require-to-throw-message": "off",
      "vitest/no-conditional-expect": "off",
      "vitest/expect-expect": "off",
      // Flags every Node-style callback invoked from a `.then`; the desktop
      // main process bridges callback APIs by design.
      "promise/no-callback-in-promise": "off",

      // --- Sloppy-code guardrails (measured 2026-09-07, all `error`) --------
      eqeqeq: ["error", "always", { null: "ignore" }],
      // Playwright fixtures take `({}, use)` when they need no other fixture.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-useless-assignment": "error",
      "no-self-compare": "error",
      "no-unneeded-ternary": "error",
      "no-useless-return": "error",
      "no-useless-rename": "error",
      "no-useless-concat": "error",
      "no-useless-computed-key": "error",
      "no-useless-escape": "error",
      "no-unused-private-class-members": "error",
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "error",
      "preserve-caught-error": "error",
      "no-promise-executor-return": "error",
      "default-case-last": "error",
      "prefer-object-has-own": "error",
      // Work-in-progress markers belong in the tracker, not in source.
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme", "xxx", "hack"], location: "anywhere" },
      ],
      "typescript/no-import-type-side-effects": "error",
      "typescript/no-confusing-non-null-assertion": "error",
      "typescript/no-non-null-asserted-nullish-coalescing": "error",
      "typescript/no-useless-empty-export": "error",
      "unicorn/error-message": "error",
      "unicorn/throw-new-error": "error",
      "unicorn/no-instanceof-builtins": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/no-useless-length-check": "error",
      "unicorn/no-await-in-promise-methods": "error",
      "unicorn/no-single-promise-in-promise-methods": "error",
      "unicorn/no-unnecessary-await": "error",
      "unicorn/no-typeof-undefined": "error",
      "unicorn/prefer-optional-catch-binding": "error",
      "unicorn/no-abusive-eslint-disable": "error",
      "unicorn/no-thenable": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/no-object-as-default-parameter": "error",
      "unicorn/no-invalid-remove-event-listener": "error",
      "unicorn/no-empty-file": "error",
      "unicorn/no-unreadable-iife": "error",
      "oxc/no-accumulating-spread": "error",
      "oxc/missing-throw": "error",
      "oxc/erasing-op": "error",
      "oxc/uninvoked-array-callback": "error",
      "oxc/const-comparisons": "error",
      "oxc/double-comparisons": "error",
      "oxc/misrefactored-assign-op": "error",
      "promise/no-return-wrap": "error",
      "promise/no-multiple-resolved": "error",
      "promise/no-new-statics": "error",
      "promise/valid-params": "error",
      "promise/no-return-in-finally": "error",
      "import/no-cycle": "error",
      "import/no-self-import": "error",
      "import/no-duplicates": "error",
      "import/no-mutable-exports": "error",
      "import/no-empty-named-blocks": "error",
      "react/jsx-key": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/no-children-prop": "error",
      "react/jsx-no-target-blank": "error",
      "react/no-unknown-property": "error",
      "react/button-has-type": "error",
      "react/jsx-no-constructed-context-values": "error",
      "react/jsx-no-comment-textnodes": "error",
      "react/jsx-no-script-url": "error",
      "react/no-danger-with-children": "error",
      "react/no-direct-mutation-state": "error",
      "react/no-string-refs": "error",
      "react/no-find-dom-node": "error",
      "react/no-is-mounted": "error",
      "react/no-render-return-value": "error",
      "react/void-dom-elements-no-children": "error",
      "vitest/valid-expect": "error",
      "vitest/no-identical-title": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
      "vitest/no-commented-out-tests": "error",
      "vitest/no-standalone-expect": "error",
      "vitest/valid-describe-callback": "error",
      "vitest/valid-title": "error",
      "vitest/no-import-node-test": "error",
      "vitest/no-mocks-import": "error",
      "vitest/no-test-return-statement": "error",

      "no-array-constructor": "error",
      "no-unused-expressions": "error",
      "no-unused-vars": "off",
      "sonarjs/class-name": "error",
      "sonarjs/no-commented-code": "error",
      "sonarjs/no-fallthrough": "error",
      "sonarjs/no-equals-in-for-termination": "error",
      "sonarjs/no-extra-arguments": "error",
      "sonarjs/no-labels": "error",
      "sonarjs/no-nested-assignment": "error",
      "sonarjs/no-redundant-boolean": "error",
      "sonarjs/prefer-single-boolean-return": "error",
      "sonarjs/unused-import": "error",
      "sonarjs/no-case-label-in-switch": "error",
      "sonarjs/no-parameter-reassignment": "error",
      "sonarjs/prefer-while": "error",
      "sonarjs/no-small-switch": "error",
      "sonarjs/no-hardcoded-ip": "error",
      "sonarjs/label-position": "error",
      "sonarjs/public-static-readonly": "error",
      "sonarjs/call-argument-line": "error",
      "sonarjs/max-switch-cases": "error",
      "sonarjs/no-unused-vars": "off",
      "sonarjs/function-inside-loop": "error",
      "sonarjs/code-eval": "error",
      "sonarjs/future-reserved-words": "error",
      "sonarjs/bitwise-operators": "error",
      "sonarjs/no-primitive-wrappers": "error",
      "sonarjs/no-skipped-tests": "error",
      "sonarjs/no-identical-expressions": "error",
      "sonarjs/constructor-for-side-effects": "error",
      "sonarjs/no-dead-store": "error",
      "sonarjs/no-identical-conditions": "error",
      "sonarjs/no-duplicated-branches": "error",
      "sonarjs/deprecation": "error",
      "sonarjs/no-inverted-boolean-check": "error",
      "sonarjs/misplaced-loop-counter": "error",
      "sonarjs/no-nested-functions": "error",
      "sonarjs/no-hardcoded-passwords": "error",
      "sonarjs/sql-queries": "error",
      "sonarjs/insecure-cookie": "error",
      "sonarjs/no-useless-increment": "error",
      "sonarjs/no-globals-shadowing": "error",
      "sonarjs/no-empty-test-file": "error",
      "sonarjs/no-ignored-return": "error",
      "sonarjs/arguments-order": "error",
      "sonarjs/pseudo-random": "error",
      "sonarjs/for-loop-increment-sign": "error",
      "sonarjs/null-dereference": "error",
      "sonarjs/no-selector-parameter": "error",
      "sonarjs/updated-loop-counter": "error",
      "sonarjs/block-scoped-var": "error",
      "sonarjs/no-ignored-exceptions": "error",
      "sonarjs/no-gratuitous-expressions": "error",
      "sonarjs/file-uploads": "error",
      "sonarjs/file-permissions": "error",
      "sonarjs/no-empty-character-class": "error",
      "sonarjs/no-unenclosed-multiline-block": "error",
      "sonarjs/index-of-compare-to-positive-number": "error",
      "sonarjs/assertions-in-tests": "error",
      "sonarjs/no-implicit-global": "error",
      "sonarjs/no-useless-catch": "error",
      "sonarjs/xml-parser-xxe": "error",
      "sonarjs/non-existent-operator": "error",
      "sonarjs/post-message": "error",
      "sonarjs/no-array-delete": "error",
      "sonarjs/no-alphabetical-sort": "error",
      "sonarjs/no-incomplete-assertions": "error",
      "sonarjs/no-global-this": "error",
      "sonarjs/new-operator-misuse": "error",
      "sonarjs/no-delete-var": "error",
      "sonarjs/cookie-no-httponly": "error",
      "sonarjs/no-nested-conditional": "error",
      "sonarjs/different-types-comparison": "error",
      "sonarjs/inverted-assertion-arguments": "error",
      "sonarjs/updated-const-var": "error",
      "sonarjs/no-invariant-returns": "error",
      "sonarjs/generator-without-yield": "error",
      "sonarjs/no-associative-arrays": "error",
      "sonarjs/comma-or-logical-or-case": "error",
      "sonarjs/no-redundant-jump": "error",
      "sonarjs/inconsistent-function-call": "error",
      "sonarjs/no-use-of-empty-return-value": "error",
      "sonarjs/void-use": "error",
      "sonarjs/cognitive-complexity": "error",
      "sonarjs/argument-type": "error",
      "sonarjs/in-operator-type-error": "error",
      "sonarjs/array-callback-without-return": "error",
      "sonarjs/function-return-type": "error",
      "sonarjs/super-invocation": "error",
      "sonarjs/no-all-duplicated-branches": "error",
      "sonarjs/no-same-line-conditional": "error",
      "sonarjs/no-collection-size-mischeck": "error",
      "sonarjs/no-unthrown-error": "error",
      "sonarjs/no-unused-collection": "error",
      "sonarjs/no-os-command-from-path": "error",
      "sonarjs/no-misleading-array-reverse": "error",
      "sonarjs/no-element-overwrite": "error",
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-empty-collection": "error",
      "sonarjs/no-redundant-assignments": "error",
      "sonarjs/prefer-type-guard": "error",
      "sonarjs/use-type-alias": "error",
      "sonarjs/no-useless-intersection": "error",
      "sonarjs/weak-ssl": "error",
      "sonarjs/no-weak-keys": "error",
      "sonarjs/csrf": "error",
      "sonarjs/production-debug": "error",
      "sonarjs/prefer-default-last": "error",
      "sonarjs/no-in-misuse": "error",
      "sonarjs/no-duplicate-in-composite": "error",
      "sonarjs/no-undefined-argument": "error",
      "sonarjs/no-nested-template-literals": "error",
      "sonarjs/prefer-promise-shorthand": "error",
      "sonarjs/os-command": "error",
      "sonarjs/no-redundant-optional": "error",
      "sonarjs/hashing": "error",
      "sonarjs/no-try-promise": "error",
      "sonarjs/unverified-certificate": "error",
      "sonarjs/no-unsafe-unzip": "error",
      "sonarjs/cors": "error",
      "sonarjs/link-with-target-blank": "error",
      "sonarjs/disabled-auto-escaping": "error",
      "sonarjs/table-header": "error",
      "sonarjs/no-table-as-layout": "error",
      "sonarjs/table-header-reference": "error",
      "sonarjs/object-alt-content": "error",
      "sonarjs/no-clear-text-protocols": "error",
      "sonarjs/publicly-writable-directories": "error",
      "sonarjs/unverified-hostname": "error",
      "sonarjs/encryption-secure-mode": "error",
      "sonarjs/no-weak-cipher": "error",
      "sonarjs/no-intrusive-permissions": "error",
      "sonarjs/insecure-jwt-token": "error",
      "sonarjs/x-powered-by": "error",
      "sonarjs/hidden-files": "error",
      "sonarjs/content-length": "error",
      "sonarjs/disabled-resource-integrity": "error",
      "sonarjs/content-security-policy": "error",
      "sonarjs/no-mixed-content": "error",
      "sonarjs/frame-ancestors": "error",
      "sonarjs/no-mime-sniff": "error",
      "sonarjs/no-referrer-policy": "error",
      "sonarjs/strict-transport-security": "error",
      "sonarjs/confidential-information-logging": "error",
      "sonarjs/no-ip-forward": "error",
      "sonarjs/empty-string-repetition": "error",
      "sonarjs/regex-complexity": "error",
      "sonarjs/anchor-precedence": "error",
      "sonarjs/slow-regex": "error",
      "sonarjs/no-invalid-regexp": "error",
      "sonarjs/unused-named-groups": "error",
      "sonarjs/no-same-argument-assert": "error",
      "sonarjs/no-misleading-character-class": "error",
      "sonarjs/duplicates-in-character-class": "error",
      "sonarjs/session-regeneration": "error",
      "sonarjs/test-check-exception": "error",
      "sonarjs/stable-tests": "error",
      "sonarjs/no-empty-after-reluctant": "error",
      "sonarjs/single-character-alternation": "error",
      "sonarjs/no-code-after-done": "error",
      "sonarjs/disabled-timeout": "error",
      "sonarjs/chai-determinate-assertion": "error",
      "sonarjs/aws-s3-bucket-insecure-http": "error",
      "sonarjs/aws-s3-bucket-versioning": "error",
      "sonarjs/aws-s3-bucket-granted-access": "error",
      "sonarjs/no-angular-bypass-sanitization": "error",
      "sonarjs/aws-iam-public-access": "error",
      "sonarjs/aws-ec2-unencrypted-ebs-volume": "error",
      "sonarjs/aws-s3-bucket-public-access": "error",
      "sonarjs/aws-iam-all-privileges": "error",
      "sonarjs/aws-rds-unencrypted-databases": "error",
      "sonarjs/aws-opensearchservice-domain": "error",
      "sonarjs/aws-iam-privilege-escalation": "error",
      "sonarjs/aws-sagemaker-unencrypted-notebook": "error",
      "sonarjs/aws-restricted-ip-admin-access": "error",
      "sonarjs/no-empty-alternatives": "error",
      "sonarjs/no-control-regex": "error",
      "sonarjs/no-regex-spaces": "error",
      "sonarjs/aws-sns-unencrypted-topics": "error",
      "sonarjs/existing-groups": "error",
      "sonarjs/aws-ec2-rds-dms-public": "error",
      "sonarjs/aws-sqs-unencrypted-queue": "error",
      "sonarjs/no-empty-group": "error",
      "sonarjs/aws-efs-unencrypted": "error",
      "sonarjs/aws-apigateway-public-api": "error",
      "sonarjs/stateful-regex": "error",
      "sonarjs/concise-regex": "error",
      "sonarjs/single-char-in-character-classes": "error",
      "sonarjs/no-hardcoded-secrets": "error",
      "sonarjs/no-exclusive-tests": "error",
      "sonarjs/hardcoded-secret-signatures": "error",
      "sonarjs/jsx-no-leaked-render": "error",
      "sonarjs/no-hook-setter-in-body": "error",
      "sonarjs/no-useless-react-setstate": "error",
      "sonarjs/no-uniq-key": "error",
      "sonarjs/redundant-type-aliases": "error",
      "sonarjs/prefer-regexp-exec": "error",
      "sonarjs/no-internal-api-use": "error",
      "sonarjs/prefer-read-only-props": "error",
      "sonarjs/no-literal-call": "error",
      "sonarjs/reduce-initial-value": "error",
      "sonarjs/no-async-constructor": "error",
      "sonarjs/review-blockchain-mnemonic": "error",
      "sonarjs/dynamically-constructed-templates": "error",
      "typescript/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "dashframe/credential-class-literals": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@wystack/server",
              message:
                "@wystack/server's raw command types (e.g. Command) are server-internal. Build commands via cmd()/CommandPayloads from @dashframe/types, or call the server's RPC surface — don't hand-assemble a { path, args } literal.",
            },
          ],
          patterns: [],
        },
      ],
      "typescript/ban-ts-comment": "error",
      "typescript/no-duplicate-enum-values": "error",
      "typescript/no-empty-object-type": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-extra-non-null-assertion": "error",
      "typescript/no-misused-new": "error",
      "typescript/no-namespace": "error",
      "typescript/no-non-null-asserted-optional-chain": "error",
      "typescript/no-require-imports": "error",
      "typescript/no-this-alias": "error",
      "typescript/no-unnecessary-type-constraint": "error",
      "typescript/no-unsafe-declaration-merging": "error",
      "typescript/no-unsafe-function-type": "error",
      "typescript/no-wrapper-object-types": "error",
      "typescript/prefer-as-const": "error",
      "typescript/prefer-namespace-keyword": "error",
      "typescript/triple-slash-reference": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        // Every package that renders React components gets the real hook
        // linter, not only the app shell.
        files: [
          "packages/app/**/*.ts",
          "packages/app/**/*.tsx",
          "packages/ui/**/*.ts",
          "packages/ui/**/*.tsx",
          "packages/visualization/**/*.ts",
          "packages/visualization/**/*.tsx",
          "apps/renderer/**/*.ts",
          "apps/renderer/**/*.tsx",
        ],
        rules: {
          ...reactHooksRules,
          // The plugin ships this at `warn`; a warning never fails the gate.
          "react-hooks-js/exhaustive-deps": "error",
        },
      },
      {
        // Storybook invokes a story's `render` as a component, so hooks inside
        // it are legitimate even though the linter cannot tell.
        files: ["**/*.stories.ts", "**/*.stories.tsx"],
        rules: {
          "react-hooks-js/rules-of-hooks": "off",
        },
      },
      {
        // Library and UI code reports through structured channels; a stray
        // console.log is debugging residue. Servers, the desktop main process,
        // repo scripts and e2e harnesses log to stdout by design and are not
        // matched here.
        files: [
          "packages/**/*.ts",
          "packages/**/*.tsx",
          "apps/web/**/*.ts",
          "apps/web/**/*.tsx",
          "apps/renderer/**/*.ts",
          "apps/renderer/**/*.tsx",
        ],
        rules: {
          "no-console": ["error", { allow: ["warn", "error"] }],
        },
      },
      {
        // CLI entry points and package-local scripts print their result.
        files: ["**/*.cli.ts", "packages/*/scripts/**"],
        rules: {
          "no-console": "off",
        },
      },
      {
        // Repo tooling: spawns bun/git/node from PATH by design, runs its
        // regexes over repo-local text only, and is procedural by nature.
        files: ["scripts/**", "apps/*/scripts/**"],
        rules: {
          "sonarjs/no-os-command-from-path": "off",
          "sonarjs/slow-regex": "off",
          "sonarjs/cognitive-complexity": "off",
        },
      },
      {
        // Root script tests run under `node --test`, not vitest.
        files: ["scripts/**/*.test.mjs"],
        rules: {
          "vitest/no-import-node-test": "off",
        },
      },
      {
        // First lint pass over packages that were never linted. The structural
        // sonar rules below need refactors (functions up to complexity 68,
        // nested ternaries throughout convex/app.ts and preview.ts); they stay
        // off here until that cleanup lands, and are the only rules relaxed.
        files: ["packages/convex-backend/**", "packages/types/**"],
        rules: {
          "sonarjs/cognitive-complexity": "off",
          "sonarjs/no-nested-conditional": "off",
          "sonarjs/regex-complexity": "off",
        },
      },
      {
        // Convex handlers declare `returns: v.null()` and therefore always
        // return null; the package runs plain vitest with its own config.
        files: ["packages/convex-backend/**"],
        rules: {
          "sonarjs/no-invariant-returns": "off",
          "vite-plus/prefer-vite-plus-imports": "off",
        },
      },
      {
        files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
        plugins: ["nextjs", "jsx-a11y"],
        rules: {
          ...reactHooksRules,
          ...nextRules,
          // The preset spread above ships exhaustive-deps at "warn"; this
          // override runs after the error-level hooks override and would
          // otherwise silently downgrade it for the web app.
          "react-hooks-js/exhaustive-deps": "error",
        },
      },
      {
        files: [
          "packages/ui/**/*.stories.ts",
          "packages/ui/**/*.stories.tsx",
          "packages/ui/.storybook/**/*.ts",
          "packages/ui/.storybook/**/*.tsx",
        ],
        rules: storybookRules,
      },
      {
        // Storybook's own config files are neither stories nor CSF modules.
        files: ["packages/ui/.storybook/**"],
        rules: {
          "storybook/story-exports": "off",
          "storybook/default-exports": "off",
        },
      },
      {
        files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
        rules: {
          "constructor-super": "off",
          "getter-return": "off",
          "no-class-assign": "off",
          "no-const-assign": "off",
          "no-dupe-class-members": "off",
          "no-dupe-keys": "off",
          "no-func-assign": "off",
          "no-import-assign": "off",
          "no-new-native-nonconstructor": "off",
          "no-obj-calls": "off",
          "no-redeclare": "off",
          "no-setter-return": "off",
          "no-this-before-super": "off",
          "no-undef": "off",
          "no-unreachable": "off",
          "no-unsafe-negation": "off",
          "no-var": "error",
          "no-with": "off",
          "prefer-const": "error",
          "prefer-rest-params": "error",
          "prefer-spread": "error",
        },
      },
      {
        files: [
          "**/*.test.ts",
          "**/*.test.tsx",
          "**/*.spec.ts",
          "**/*.spec.tsx",
        ],
        rules: {
          "sonarjs/no-nested-functions": "off",
          "dashframe/credential-class-literals": "off",
        },
        jsPlugins: ["eslint-plugin-sonarjs"],
      },
      {
        files: ["**/credential-classes.ts"],
        rules: {
          "dashframe/credential-class-literals": "off",
        },
      },
      {
        files: ["scripts/oxlint-plugin-dashframe.mjs"],
        rules: {
          "dashframe/credential-class-literals": "off",
        },
      },
      {
        files: ["vite.config.ts"],
        rules: {
          "sonarjs/no-hardcoded-passwords": "off",
        },
      },
      {
        files: ["apps/server/**/*.ts", "apps/server/**/*.tsx"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [],
              patterns: [],
            },
          ],
        },
      },
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: [
      "node_modules",
      "**/dist",
      "**/build",
      "**/.next",
      "**/.next-e2e",
      "**/out",
      "**/.turbo",
      "coverage",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/*.tsbuildinfo",
      "e2e/web/features/.generated",
      "e2e/web/test-results",
      "apps/renderer/src/routeTree.gen.ts",
      "apps/web/src/routeTree.gen.ts",
      "libs/",
    ],
  },
});
