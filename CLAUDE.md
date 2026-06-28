# DashFrame

## Design Context

Visual design system: see [DESIGN.md](DESIGN.md). Load it before any UI work.

Key facts: product register; `@wystack/ui` tokens are the source of truth (vendored at `libs/stdui` — historical directory name); the shell is built on the **surface system** (`bg-surface-base` canvas, `--surface-radius`/`--surface-inset` geometry, shadow-lifted panels, no borders); web and Electron renderers are identical — no per-surface UI forks; no off-token color.

## Worktree isolation (dispatched agents)

Every dispatched agent that touches source files MUST work in an isolated git worktree — never in the shared main checkout (`/Users/youhaowei/Projects/DashFrame`). Two agents in the same checkout will revert each other's uncommitted work.

**Bootstrap (first step in any feature-branch brief):**
```sh
worktree=$(scripts/ensure-worktree.sh <branch-name>)
cd "$worktree"
# all work happens here
```

`scripts/ensure-worktree.sh` creates `~/worktrees/dashframe/<branch>` if not already there and prints the path. If it fails, STOP — do not improvise another location.

**Enforcement:** `.husky/pre-commit` blocks commits on a non-default branch in the main checkout. Bypass with `ALLOW_MAIN_CHECKOUT_COMMIT=1` only when you knowingly own that checkout.

## Pull requests

Every PR description follows `.github/pull_request_template.md`. The **Screenshots** section is required on all PRs: any UI-touching change (components, layout, CSS, tokens — anything rendered) must include before/after images captured from the running app, with the relevant states (hover/focus, light + dark) when they changed. A diff cannot show hover, focus, spacing, or dark mode. Backend-only PRs satisfy the section by stating "No UI change". This is a hard expectation, not a nicety — a UI PR without visual evidence is not ready for review.
