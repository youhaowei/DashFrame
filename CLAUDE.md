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

`scripts/ensure-worktree.sh` creates `~/worktrees/dashframe/<branch-slug>` (forward-slashes and colons in the branch name become dashes, lowercase) if not already there and prints the path. If it fails, STOP — do not improvise another location.

**Enforcement:** `.husky/pre-commit` blocks commits on a non-default branch in the main checkout. Bypass with `ALLOW_MAIN_CHECKOUT_COMMIT=1` only when you knowingly own that checkout.

## Pull requests

Every PR description follows `.github/pull_request_template.md`. The **Screenshots** section is required on all UI-touching PRs: capture proof from the running app (relevant states — hover/focus, light + dark when they changed). Backend-only PRs state "No UI change".

**Do not commit screenshot PNGs or add per-PR/per-ticket capture scripts to this repo.** Capture to `/tmp`, then attach with **`pr-screenshots`** (`~/.local/share/pr-screenshots`, any agent/shell) and [@vercel/before-and-after](https://jm.sv/before-and-after) when needed. A diff cannot show hover, focus, spacing, or dark mode — visual evidence in the PR body is merge-blocking for UI changes.
