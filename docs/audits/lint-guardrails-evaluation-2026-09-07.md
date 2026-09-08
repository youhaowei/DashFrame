# Lint guardrails evaluation

Measured 2026-09-07 against `origin/main` at `4cdde3b3` with Vite+ 0.2.9
(oxlint 1.73.0, `@oxlint/plugins` 1.73.0). This is the record behind the lint
policy in `vite.config.ts`: what was measured, what was adopted, what was
rejected and why, and what is left for later. It supersedes
`anti-slop-rule-evaluation.md`, which evaluated one third-party rule set; this
pass evaluated everything the linter already ships.

## Why

The repo's lint policy was the migration-time parity config from the Vite+
move: `categories.correctness` was `off`, 21 native rules were enabled by
name, and the one rule that catches dead code (`typescript/no-unused-vars`)
ran at `warn`, which never fails the gate. The sonarjs list was large but the
native oxlint surface that catches the mistakes generated code makes most
often (unreachable branches, unused imports, un-awaited assertions, import
cycles, missing `type="button"`) was almost entirely dark.

## Method

1. Enumerate the 835 rule keys in the installed oxlint.
2. Run the linter once over `apps packages scripts e2e vite.config.ts` with
   every category at `warn` and every plugin enabled, and count unique
   findings per rule (file, line, column).
3. Re-run with candidate option sets (`eqeqeq` null-ignore, `no-empty`
   without empty catch, `no-console` allowing `warn`/`error`,
   `consistent-type-assertions` forbidding object-literal casts, `max-depth`
   and `max-params` at relaxed limits, `--report-unused-disable-directives`).
4. Read the source behind every rule with fewer than ~25 findings to decide
   real defect versus false positive versus style.
5. Adopt at `error` only. A rule at `warn` does not fail `bun run check`, so it
   is invisible to the agents this policy is for.

## Adopted

`categories.correctness: "error"` for the native `oxc`, `typescript`,
`react`, `unicorn`, `promise`, `import` and `vitest` plugins, plus the
explicit rules listed in `vite.config.ts`. The rules with findings on main,
and how each was resolved:

| Rule                                                                                                                                                                                                                                    | Findings on main | Resolution                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: | --------------------------------------------------------------------------------------- |
| `unicorn/prefer-node-protocol`                                                                                                                                                                                                          |               26 | autofix                                                                                 |
| `react/button-has-type`                                                                                                                                                                                                                 |               23 | `type="button"` added                                                                   |
| `no-unsafe-optional-chaining`                                                                                                                                                                                                           |               20 | tests: assert then non-null                                                             |
| `no-promise-executor-return`                                                                                                                                                                                                            |               18 | block-bodied executors                                                                  |
| `import/no-duplicates`                                                                                                                                                                                                                  |               10 | autofix / merged                                                                        |
| `preserve-caught-error`                                                                                                                                                                                                                 |               10 | `{ cause }` attached (one AggregateError site disabled with reason)                     |
| `no-console` (scoped, allow warn/error)                                                                                                                                                                                                 |                8 | debug traces removed; two gated loggers and CLI/scripts exempted                        |
| `typescript/no-unused-vars` → error                                                                                                                                                                                                     |                6 | unused imports removed                                                                  |
| `typescript/no-import-type-side-effects`                                                                                                                                                                                                |                5 | autofix                                                                                 |
| `react-hooks-js/exhaustive-deps` → error, extended to ui/visualization/renderer                                                                                                                                                         |                5 | deps fixed (VirtualTable, Chart)                                                        |
| `import/no-cycle`                                                                                                                                                                                                                       |         2 cycles | connector-notion split (`fields.ts`); convex host↔hostBatches split (`hostCommands.ts`) |
| `prefer-object-has-own`                                                                                                                                                                                                                 |                4 | autofix                                                                                 |
| `vitest/valid-expect`                                                                                                                                                                                                                   |                2 | un-awaited async assertions awaited                                                     |
| `unicorn/no-thenable`                                                                                                                                                                                                                   |                2 | JSON Schema `then` keyword, disabled with reason                                        |
| `unicorn/no-useless-length-check`                                                                                                                                                                                                       |                2 | simplified                                                                              |
| `no-useless-escape`                                                                                                                                                                                                                     |                2 | autofix                                                                                 |
| `no-empty-pattern`                                                                                                                                                                                                                      |                2 | option `allowObjectPatternsAsParameters` (Playwright fixtures)                          |
| `no-warning-comments`                                                                                                                                                                                                                   |                1 | TODO resolved                                                                           |
| `no-control-regex`                                                                                                                                                                                                                      |                1 | NUL-strip regex, disabled with reason                                                   |
| `no-throw-literal`                                                                                                                                                                                                                      |                1 | test throws a string on purpose, disabled with reason                                   |
| `prefer-promise-reject-errors`, `vitest/no-identical-title`, `react/jsx-no-constructed-context-values`, `oxc/no-accumulating-spread`, `unicorn/no-useless-fallback-in-spread`, `unicorn/no-object-as-default-parameter`, `prefer-const` |           1 each | fixed                                                                                   |

Everything else adopted had zero findings; the rules are there for the code
that has not been written yet.

Explicit `off` entries, each with its reason in the config: the classic-runtime
`react/react-in-jsx-scope` (2761), oxlint's own `react-hooks/*` (13 false
positives on `.use()` methods; the eslint-plugin-react-hooks jsPlugin is
authoritative), `no-duplicate-imports` (74, all `import type` splits),
`no-eq-null` (contradicts the `eqeqeq` null-ignore policy), and four vitest
rules that ship in its correctness bucket but are style here
(`require-mock-type-parameters` 630, `require-to-throw-message` 134,
`no-conditional-expect` 51, `expect-expect` false positives on
`getByRole`).

## Rejected for now

| Rule                                                                           |           Findings | Why not now                                                                 |
| ------------------------------------------------------------------------------ | -----------------: | --------------------------------------------------------------------------- |
| `typescript/no-non-null-assertion`                                             |                594 | policy decision, not a lint PR                                              |
| `require-await`                                                                | 468 (390 in tests) | the type-aware `typescript/require-await` is the right rule; see follow-ups |
| `typescript/consistent-type-assertions` (`objectLiteralTypeAssertions: never`) |                172 | mostly test fixtures; worth a dedicated cleanup                             |
| `unicorn/no-useless-undefined`                                                 |                142 | style                                                                       |
| `max-params` (5)                                                               |                 12 | refactors                                                                   |
| `no-shadow`                                                                    |      95 (64 tests) | refactors                                                                   |
| `unicorn/no-array-for-each`                                                    |                 76 | style                                                                       |
| `unicorn/catch-error-name`                                                     |                 53 | style                                                                       |
| `unicorn/consistent-function-scoping`                                          |                 50 | style                                                                       |
| `oxc/no-map-spread`                                                            |                 35 | perf hint, not a defect                                                     |
| `no-implicit-coercion`                                                         |                 25 | `!!x` idiom                                                                 |
| `no-void`                                                                      |                 22 | `void promise` is the fire-and-forget idiom                                 |
| `unicorn/no-useless-switch-case`                                               |                 20 | deliberate exhaustive case lists                                            |
| `no-alert`                                                                     |                 18 | `confirm()` in InsightConfigPanel is a product call                         |
| `react/jsx-no-useless-fragment`                                                |                 15 | style                                                                       |
| `max-depth` (5)                                                                |                  1 | suggest-charts nesting; refactor                                            |
| `no-empty-function`                                                            |      83 (67 tests) | noop callbacks are legitimate                                               |
| `react/no-array-index-key`                                                     |                 10 | static lists                                                                |
| `promise/catch-or-return`                                                      |                  5 | `.finally()` chains on never-rejecting lifecycle promises                   |
| `promise/always-return`                                                        |                  8 | companion of the above                                                      |
| `react/no-unstable-nested-components`                                          |                  1 | false positive on TanStack column `cell` renderers                          |
| `vitest/no-import-node-test` in `scripts/**/*.test.mjs`                        |                  1 | those tests run under `node --test`                                         |
| `typescript/no-dynamic-delete`                                                 |                 11 | legitimate in stores                                                        |
| `--report-unused-disable-directives`                                           |            0 today | CLI-only flag; would need adding to every package lint script               |

## Coverage

Four workspaces were outside the lint gate. `bun run check` runs turbo's
`check` task, whose `lint` dependency only fires where a `lint` script exists:

- `packages/types` and `packages/desktop-types` had no lint script.
- `packages/convex-backend`'s lint script was `tsc --noEmit`.
- `e2e/web` had no lint, typecheck or test script and was absent from the graph.
- Root `scripts/` and `vite.config.ts` were linted by nothing.
- `apps/desktop/scripts/` and `packages/ui/.storybook/` sat outside their
  packages' `vp lint src` globs.

All of them now lint; the root pair through `check:root-lint` in
`scripts/run-checks.mjs`, the last two by widening the package lint scripts.
The first pass over `apps/desktop/scripts/dev.mjs` found a promise executor
that could resolve twice (`promise/no-multiple-resolved`); `stopChild` was
rewritten around a single exit listener. The first pass over the never-linted packages
surfaced structural sonar findings that need refactors rather than edits
(functions with cognitive complexity up to 68 in `convex/preview.ts`, nested
ternaries throughout `convex/app.ts`, two long keyword regexes in
`packages/types/src/sensitivity.ts`). Those three rules are `off` for
`packages/convex-backend/**` and `packages/types/**` by an override that names
them; nothing else is relaxed there.

## Defects the new rules found on main

- Two un-awaited `expect(...).rejects` assertions in
  `apps/server/src/host/local-ingest-lifecycle.test.ts` that could never fail.
- Import cycle `packages/connector-notion/src/index.ts` ↔ `connector.ts`.
- Import cycle `packages/convex-backend/convex/host.ts` ↔ `hostBatches.ts`,
  removed by moving the shared host command helpers into `hostCommands.ts`.
- Five hook dependency mistakes in `packages/ui/src/components/VirtualTable.tsx`
  and `packages/visualization/src/components/Chart.tsx`, in packages the hook
  linter did not cover (`resolveRenderer` was recreated every render and
  omitted from the effect's dependencies).
- Six unused imports, a duplicate `describe` title, and 23 `<button>`
  elements without an explicit `type`.

## Follow-ups

1. **Type-aware lint.** `vp lint --type-aware` fails with
   `typescript(tsconfig-error)` because the package tsconfigs set no
   `rootDir`. With `rootDir: "src"` added to `packages/engine/tsconfig.json`
   the probe ran and reported, for that package alone: 59
   `no-unnecessary-type-assertion`, 20 `no-unsafe-type-assertion`, 18
   `no-unnecessary-condition`, 2 `no-base-to-string`, 1
   `prefer-nullish-coalescing`. Adding `rootDir` to every package and turning
   on `no-floating-promises`, `no-misused-promises`, `await-thenable`,
   `require-await`, `switch-exhaustiveness-check` and
   `no-unnecessary-type-assertion` is the next step up.
2. **Chained `as unknown as` casts.** 139 sites. A cleanup in its own right
   before any assertion rule tightens.
3. **anti-slop `no-widen-then-assert`.** The vendored version proposed in the
   closed PR had a false positive on validated objects and could be bypassed
   through a named alias or `globalThis`. Re-vendoring it needs regression
   fixtures for all three before it goes on.
4. **`SelectField` `onClear` is a dead prop.** `packages/ui/src/fields/select.tsx`
   declares `onClear` in `SelectProps` but never used it; `no-unused-vars`
   flagged the destructured value and it was dropped from the destructuring.
   Four callers still pass it (`AxisSelectField`, `VisualizationPageContent`,
   `OverridePopover`). Either wire a clear affordance or delete the prop and
   the call sites.
5. **`react-hooks-js/incompatible-library` warning in `VirtualTable.tsx`.**
   TanStack Virtual's `useVirtualizer` returns a mutable instance, which the
   React Compiler lint reports as incompatible with memoization. It is
   informational (a warning, not an error) and stays visible in lint output
   as a reminder that the component is not compiler-safe.
6. **Structural rules in `convex-backend` and `types`.** See Coverage.
7. **Unused disable directives.** Add
   `--report-unused-disable-directives` to the package lint scripts once
   they are unified; the count today is zero.
