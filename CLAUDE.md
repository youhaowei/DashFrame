# DashFrame

## Design Context

Visual design system: see [DESIGN.md](DESIGN.md). Load it before any UI work.

Key facts: product register; `@wystack/ui` tokens are the source of truth (vendored at `libs/stdui` — historical directory name); the shell is built on the **surface system** (`bg-surface-base` canvas, `--surface-radius`/`--surface-inset` geometry, shadow-lifted panels, no borders); web and Electron renderers are identical — no per-surface UI forks; no off-token color.
