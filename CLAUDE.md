# DashFrame

## Design Context

Visual design system: see [DESIGN.md](DESIGN.md). Load it before any UI work.

Key facts: product register; `@wystack/ui` tokens are the source of truth (vendored at `libs/stdui` — historical directory name); the shell is built on the **surface system** (`bg-surface-base` canvas, `--surface-radius`/`--surface-inset` geometry, shadow-lifted panels, no borders); web and Electron renderers are identical — no per-surface UI forks; no off-token color.

## Pull requests

Every PR description follows `.github/pull_request_template.md`. The **Screenshots** section is required on all PRs: any UI-touching change (components, layout, CSS, tokens — anything rendered) must include before/after images captured from the running app, with the relevant states (hover/focus, light + dark) when they changed. A diff cannot show hover, focus, spacing, or dark mode. Backend-only PRs satisfy the section by stating "No UI change". This is a hard expectation, not a nicety — a UI PR without visual evidence is not ready for review.
