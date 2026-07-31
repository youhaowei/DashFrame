# DashFrame

DashFrame is a local-first BI tool (import data → DuckDB → charts). It ships as
two surfaces of the same UI (`packages/app`): an Electron **desktop** app and a
browser **web** app, both backed by the same Hono HTTP+WS server code.

Package manager is **Bun** (pinned `bun@1.3.5`); orchestration is Turborepo.
`bun` is on `PATH` (`/usr/local/bin/bun` in the cloud VM, Homebrew locally).

## Design Context

Visual design system: see [DESIGN.md](DESIGN.md). Load it before any UI work.

Key facts: product register; `@wystack/ui-core` (core tokens/utils) + `@wystack/ui-react` (components) are the source of truth (vendored at `libs/stdui` — historical directory name); the shell is built on the **surface system** (`bg-surface-base` canvas, `--surface-radius`/`--surface-inset` geometry, shadow-lifted panels, no borders); web and Electron renderers are identical — no per-surface UI forks; no off-token color.

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

## Local review gate (run before every push)

Every change is reviewed **locally before it is pushed** — CI _confirms_ a clean
result, it does not _discover_ problems. Before you push a branch, and again
before you mark any PR ready for review, run all three checks below against the
branch diff (`git diff origin/main...HEAD`) and resolve what they surface. A red
result or an unresolved finding is a **push-blocker** — do not defer it to CI or
to a human reviewer.

1. **Code review.** Review the full branch diff for correctness, security, and
   fit with the surrounding code. In Claude Code run `/code-review`; otherwise
   dispatch a reviewer over `git diff origin/main...HEAD`. Fix every blocker and
   consciously dismiss lower findings — never push past an open blocker.
   (`/code-review ultra` is the heavier multi-agent cloud pass, user-triggered
   only; it does not replace this local pass.)

2. **QA — behavioral.** Boot the app and exercise the _changed surface_ against
   what it is supposed to do; do not infer behavior from the diff alone.
   - Desktop: `bun run dev` (needs a display).
   - Web + server, headless: see **Running for browser/headless testing** below.
   - UI changes additionally require visual proof from the running app in the PR
     (relevant states, light + dark) — see **Pull requests** below.

3. **Clawpatch.** Run `bun run clawpatch:review:branch -- <branch-or-sha>`. It
   maps the repo and reviews the branch diff (`--since origin/main`) in an
   isolated worktree with shared Clawpatch state. Work the results before
   pushing with `scripts/clawpatch.sh next` / `triage` / `fix` (or
   `bun run clawpatch` for the raw CLI). Land or explicitly triage every
   finding — an untriaged Clawpatch finding blocks the push.

Docs-only changes (no code) may skip QA and Clawpatch, but still review the diff.

## Lint / test / build

Use the project's own gate `bun check`, which runs the ticket-ref check
(`scripts/check-no-ticket-refs.mjs`) and then `turbo check --filter=!@wystack/*`
(lint + typecheck + test, excluding the vendored submodule packages). The
`@wystack/*` packages lint with `oxlint`, which is not installed, so a raw
`bun run lint` / `turbo lint` fails on `@wystack/ui`; the project deliberately
filters them out. The per-task commands below skip the ticket-ref gate — run
`bun check` (or `bun run check:ticket-refs`) if you touched code that might carry
ticket references.

- Lint: `bunx turbo lint --filter='!@wystack/*'`
- Test: `bunx turbo test --filter='!@wystack/*'`
- Build: `bunx turbo build --filter='!@wystack/*'`

## Pull requests

Every PR description follows `.github/pull_request_template.md`. The **Screenshots** section is required on all UI-touching PRs: capture proof from the running app (relevant states — hover/focus, light + dark when they changed). Backend-only PRs state "No UI change".

**Do not commit screenshot PNGs, add per-PR/per-ticket capture scripts, or push images to a side branch.** Capture to `/tmp`, then attach with **`pr-screenshots`** (`~/.local/share/pr-screenshots`, any agent/shell) and [@vercel/before-and-after](https://jm.sv/before-and-after) when needed. A branch linked from a merged PR can never be deleted without 404ing its images; the release `pr-screenshots` creates is the hosting, so never delete it either. A diff cannot show hover, focus, spacing, or dark mode — visual evidence in the PR body is merge-blocking for UI changes.

## Git submodules (`libs/wystack`, `libs/stdui`)

Two vendored dependencies are **git submodules**, each with its own GitHub repo:

- `libs/wystack` → `youhaowei/wystack` — the RPC/data substrate (`@wystack/*`).
- `libs/stdui` → `youhaowei/stdui` — the `@wystack/ui-*` design system.

The `@dashframe/*` packages consume their **built** output, so `bun run setup`
(and CI) init the submodules and run `bun run build:wystack` before anything
else. If imports from `@wystack/*` fail to resolve, the submodule is
uninitialized or unbuilt — run `git submodule update --init --recursive && bun run build:wystack`.

**Changing submodule code is a two-repo change — never edit in place and commit
only the pin.** The parent repo records a submodule as a pinned commit SHA; a
bare pin bump merges even when the submodule code it points at was never
reviewed. The workflow:

1. **Land the submodule change first, in its own repo.** Open and merge a PR in
   `youhaowei/wystack` (or `youhaowei/stdui`) against that repo's default branch.
   Run its own gate there — the parent's `bun check` filters `@wystack/*` out
   (`--filter=!@wystack/*`), so it does **not** cover submodule code.
2. **Then bump the pin in DashFrame.** In the submodule dir, check out the merged
   commit; from the repo root, `git add libs/wystack` (or `libs/stdui`) and commit
   the new SHA. Rebuild: `bun run build:wystack`, then run the full `bun check` so
   the parent is verified against the new substrate — a pin that merges is not the
   same as a submodule that is compatible.
3. **Re-point after the submodule merges.** If the submodule PR merged with a
   squash/rebase, the pin must point at the merged commit on the default branch,
   not the pre-merge feature SHA.

**Worktree isolation applies to submodules too.** Parallel agents that both touch
`libs/wystack` need their **own** wystack worktree each — two agents sharing one
submodule checkout revert each other exactly like the parent repo (see
**Worktree isolation** above). Trust the submodule PR's own remote state as the
source of truth for what has landed.

## Cursor Cloud specific instructions

Dependency refresh (submodules + install + build of the vendored `@wystack/*`
packages) is handled by the startup update script; see root `package.json`
`setup` for the equivalent steps.

### Running for browser/headless testing (recommended in the cloud VM)

The web app is **not** purely client-side — it needs the backend API, or data
import fails with `404` on `/api/*` and a failed `/api/ws` WebSocket. Run two
processes:

1. API server (fixed loopback port; loopback needs no token):
   `cd apps/server && bun run src/index.ts --host 127.0.0.1 --port 4000`
   (bare `bun run dev` also works but picks an OS-assigned port). It opens a
   project at `~/.DashFrame/web-project`.
2. Web app pointed at it:
   `cd apps/web && PORT=3000 VITE_WYSTACK_URL=http://127.0.0.1:4000 bun run dev:direct`
   Open `http://127.0.0.1:3000/`. In dev the browser talks same-origin and Vite
   proxies `/api` (incl. ws) to `VITE_WYSTACK_URL`. Use `dev:direct` (plain
   Vite) rather than `bun run dev`, which wraps Vite in `portless`.

Root `bun run dev` launches the **Electron desktop** app (embeds the server
in-process, auto-starts the renderer on 5173). It needs a display, so it is not
suitable for the headless VM — prefer the web+server combo above.

### Committing (pre-commit worktree guard)

`.husky/pre-commit` refuses feature-branch commits made from the **main
checkout** (it's meant to force human/local multi-agent work into isolated
worktrees via `scripts/ensure-worktree.sh`, per **Worktree isolation** above). A
Cursor Cloud agent works on its branch directly in the single main checkout, so
that guard would block every commit. Commit with the documented bypass:
`ALLOW_MAIN_CHECKOUT_COMMIT=1 git commit ...`. The hook still runs `lint-staged`
(prettier) on staged files.
