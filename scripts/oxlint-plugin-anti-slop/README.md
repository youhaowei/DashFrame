# DashFrame anti-slop plugin

Selected rules vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
at commit `446268e5d15baa968eaec669ff65358d36ae6259`.

DashFrame intentionally keeps only rules that have a clear type-evidence contract and
no existing violations:

- `no-reflect-apply`
- `no-widen-then-assert`

Both are enabled at `error` from the root `vite.config.ts`. `@oxlint/plugins` is a
direct devDependency pinned to `1.73.0`, the exact version Vite+ 0.2.9 bundles, so
the plugin and the linter that loads it share one copy.

The rule sources are upstream's, reformatted by Oxfmt; `no-reflect-apply`
additionally inlines upstream's `shared/reflect-method.ts` helper, since only the
`apply` case is vendored. This directory is a DashFrame-owned fork under the
included MIT license — upstream changes are not pulled in automatically.

`fixtures/` holds the cases `scripts/check-anti-slop-rules.mjs` lints on every
`bun run check`: `invalid.ts.fixture` must be reported, `valid.ts.fixture` must
not. Keep that guard's `EXPECTED` line numbers in sync when editing a fixture.

The broader evaluation and the thirteen rejected rules are documented in
`docs/audits/anti-slop-rule-evaluation.md`.
