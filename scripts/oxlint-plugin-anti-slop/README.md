# DashFrame anti-slop plugin

Selected rules vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
at commit `446268e5d15baa968eaec669ff65358d36ae6259`.

DashFrame intentionally keeps only rules that have a clear type-evidence contract and
no existing violations:

- `no-reflect-apply`
- `no-widen-then-assert`

The broader evaluation and rejected rules are documented in
`docs/audits/anti-slop-rule-evaluation.md`. This directory is maintained as a
DashFrame-owned fork under the included MIT license.
