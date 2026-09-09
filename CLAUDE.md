# DashFrame

@AGENTS.md

## Operations

AGENTS.md (imported above) is the operational companion to this file: how to run the app (desktop and headless web+server), the lint/test/build commands, and the **local review gate**. That gate — code review + behavioral QA + a second review pass on a different model (Codex), run on the branch diff (`git diff origin/main...HEAD`) — is **mandatory before every push and before marking any PR ready**. The one exception is narrow — a change confined to documentation and other prose files skips QA and the second reviewer but still gets code review; anything executable (application source, scripts, CI workflows, manifests, build wiring) does not qualify, and neither does a comment-only edit inside a source file. CI only _confirms_ the gate; it does not replace it. Read AGENTS.md before pushing.

Artifact metadata, drafts, and reactive subscriptions use native local Convex. The Hono host owns sessions, connectors, secrets, and DuckDB access. Provision the pinned backend with `bun --filter @dashframe/convex-local provision` before running either surface; startup does not download binaries or register a cloud deployment.

## Design Context

Visual design system: see [DESIGN.md](DESIGN.md). Load it before any UI work.

Key facts: product register; `@wystack/ui-core` (core tokens/utils) + `@wystack/ui-react` (components) are the source of truth (vendored at `libs/stdui` — historical directory name); the shell is built on the **surface system** (`bg-surface-base` canvas, `--surface-radius`/`--surface-inset` geometry, shadow-lifted panels, no borders); web and Electron renderers are identical — no per-surface UI forks; no off-token color.

## Worktree isolation (dispatched agents)

Every dispatched agent that touches source files MUST work in an isolated git
worktree — never in the shared main checkout. Bootstrap, enforcement, and
teardown are defined in `AGENTS.md` → **Worktrees**; the short version:
`worktree=$(scripts/ensure-worktree.sh <branch>)` to start,
`scripts/remove-worktree.sh <path>` to tear down, and never improvise around
either script.

## Pull requests

Use the `type(scope): subject` convention in `AGENTS.md` → **Commit messages and
PR titles**. Do not prefix titles with agent names.

Every PR description follows `.github/pull_request_template.md`. The **Screenshots** section is required on all UI-touching PRs: capture proof from the running app (relevant states — hover/focus, light + dark when they changed). Backend-only PRs state "No UI change".

**Do not commit screenshot PNGs or add per-PR/per-ticket capture scripts to this repo.** Capture to `/tmp`, then upload with `gh pr create|edit|comment --attach '/tmp/<file>.png#<alt text>'` (one flag per file), and [@vercel/before-and-after](https://jm.sv/before-and-after) when needed. **Placing the images is a second step:** `--attach` uploads each file and appends it to the end of the body — it does not substitute `![alt](./file.png)` references you wrote, even when the filename matches, so those stay in the body as broken relative links. Read the body back (`gh pr view <n> --json body`), move the returned `https://github.com/user-attachments/assets/...` URLs to where they belong, drop the appended copies, and `gh pr edit --body-file`. A diff cannot show hover, focus, spacing, or dark mode — visual evidence in the PR body is merge-blocking for UI changes.
