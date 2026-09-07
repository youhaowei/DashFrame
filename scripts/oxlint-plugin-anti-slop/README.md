# DashFrame anti-slop plugin

Selected rules vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
at commit `446268e5d15baa968eaec669ff65358d36ae6259`.

DashFrame intentionally keeps only rules that have a clear type-evidence contract and
no existing violations:

- `no-reflect-apply`
- `no-widen-then-assert`

Both are enabled at `error` from the root `vite.config.ts`. `@oxlint/plugins` is pinned
in the root `catalog` to `1.73.0`, the exact version Vite+ 0.2.9 depends on, so the
plugin and the linter that loads it share one copy. It sits in the catalog next to
`vite-plus` because that is what dictates its value: bumping Vite+ without bumping this
in step would leave the vendored plugin importing a stale `@oxlint/plugins`.

## What is upstream's and what is ours

`rules/` and `shared/` are upstream's files **byte for byte**. They are listed in both
`lint.ignorePatterns` and `fmt.ignorePatterns` in `vite.config.ts`, as upstream's own
integration guide instructs — otherwise Oxfmt reflows them and every future re-vendor
becomes a whole-file diff with the real change buried in whitespace churn. Verify with:

```sh
diff -r <upstream>/src/rules/no-reflect-apply.ts rules/no-reflect-apply.ts
```

`index.ts` is ours: it registers only the two adopted rules, not upstream's fifteen.
`fixtures/` and the guard that reads them are ours too, and both stay formatted.

This directory is a DashFrame-owned fork under the included MIT license — upstream
changes are not pulled in automatically.

## Tests

`fixtures/` holds the cases `scripts/check-anti-slop-rules.mjs` lints on every
`bun run check`: `invalid.ts.fixture` must be reported, `valid.ts.fixture` must not.
Keep that guard's `EXPECTED` line numbers in sync when editing a fixture.

The guard also scans `apps/`, `packages/`, `scripts/`, and `vite.config.ts`,
checking the two adopted rules even in packages without a Vite+ lint task.
Its subprocess regression tests cover malformed reports, setup cleanup, warning
severity, and source violations.

The guard is the only gate coverage this directory gets. `turbo check` runs per-package
tasks, and the root package is not one, so nothing here is typechecked or linted by
the workspace portion of `bun run check`. What the guard does catch is the failure that matters: a plugin that
stops loading, a rule that stops matching, or a rule quietly downgraded from `error`
all fail it immediately.

Upstream's per-rule test suites are **not** vendored. They use `RuleTester` from
`oxlint/plugins-dev`, which needs a real Node runtime and throws under Bun, so they
cannot run from `bun run check` as this repo invokes it. That is fine while `rules/`
and `shared/` stay byte-identical to upstream — there is nothing local to regress. If
you ever edit a rule, port upstream's `<rule>.test.ts` first and run it under Node;
the fixtures here cover wiring, not rule semantics.

## Known sharp edge

`no-widen-then-assert` fires on building into an open record and asserting it narrower
at the end:

```ts
const acc: Record<string, unknown> = {};
for (const key of keys) acc[key] = makeHandler(key);
return acc as Record<string, Handler>; // reported
```

That is the rule working as designed, not a false positive, and it is worth knowing
about because DashFrame's row and spec contracts (`DataFrameRow`, `VegaLiteSpec`) are
`Record<string, unknown>`. The fix is to declare the accumulator at its target type;
both shapes are pinned in the fixtures.

The broader evaluation and the thirteen rules not adopted — seven rejected, six
warn-first candidates — are documented in `docs/audits/anti-slop-rule-evaluation.md`.

## Syntactic limits

The rule does not model runtime validation. For an assembled object such as
`const raw: unknown = { id }`, validating it later does not excuse erasing the
known object structure. Keep `const raw = { id }`, validate the unknown field,
and then assert the boundary type; the valid fixture pins this allowed pattern.
Unknown parameters remain supported.

The rule also does not resolve named type aliases to their underlying structure.
An assertion to `HandlersByKey` may be missed where an inline
`Record<string, Handler>` is reported. This is a known detection limit of the
vendored syntactic rule, not a guarantee that every equivalent flow is caught.
We retain the upstream implementation rather than adding a partial type resolver.
