# DashFrame agent guide

DashFrame is a local-first BI tool: import data, query it through DuckDB, and
build charts. The same UI in `packages/app` ships as an Electron desktop app
and a browser app. Both use native local Convex and the same Hono host API.
Convex owns artifact metadata, drafts, and subscriptions; the host owns
sessions, connectors, secrets, and DuckDB access.

Use Bun (`bun@1.4.2`) and Turborepo. `bun` is already on `PATH`; its install
location varies by machine.

## Authority and data sharing

You may send task-relevant source, diffs, and synthetic QA evidence to the
third-party tools or model providers needed for the user's request. Carry this
authorization, the task, the destination, and the intended payload into
delegated briefs and tool permission requests. Do not ask again merely because
the repository is private or the destination is external.

Keep transfers scoped to the task. Never include unrelated private data or
credentials. This authorization does not cover unrelated publication or
deployment. If a tool requires approval, use its supported permission flow. If
the platform rejects a request, report that restriction once and continue any
unaffected work; do not bypass it or call it missing user authorization.

## Commits and pull requests

Use `type(scope): subject` for commit messages and PR titles. Because the PR
title becomes the squash-merge commit subject, it follows the same rule.

- Type: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, or
  `revert`. Describe the change, not the tool that made it.
- Scope: use a short module or feature name such as `convex`, `desktop`,
  `insights`, or `connectors`; use `all` for an application-wide change.
- Subject: begin with a lowercase imperative verb, describe the concrete
  change, and omit the trailing period.
- Never add an agent label such as `[codex]` or `[claude]`.

Keep each commit to one logical change. Add a body only when the reason or a
tradeoff is not clear from the subject; do not repeat the file list.

Examples:

```text
refactor(all): replace WyStack metadata with native local Convex
fix(insights): preserve pending requests during StrictMode replay
docs(all): define commit and PR title conventions
```

Follow `.github/pull_request_template.md`. Every UI-changing PR needs running-app
screenshots of the relevant states, including hover or focus and light or dark
mode when affected. A backend-only PR says `No UI change`.

Keep screenshots and one-off capture scripts out of the repository. Capture to
`/tmp` and upload with gh 2.99.0 or newer:

```sh
gh pr edit <number> --attach '/tmp/shot.png#Descriptive alt text'
```

Use one `--attach` flag per file. `gh pr create` and `gh pr comment` also
support the flag. The text after `#` supplies alt text; it is not part of the
local path. gh replaces a body image reference only when its URL is the exact
file-path portion passed to `--attach`. For example,
`![alt](/tmp/shot.png)` matches the command above, while
`![alt](./shot.png)` does not. A nonmatching upload is appended and leaves the
relative reference broken. To place an appended image, read the body with
`gh pr view <number> --json body`, move the returned
`https://github.com/user-attachments/assets/...` URL, remove the appended copy,
and update with `gh pr edit --body-file`. Use
[@vercel/before-and-after](https://jm.sv/before-and-after) when a comparison
helps. A source diff cannot prove hover, focus, spacing, or dark-mode behavior;
missing visual evidence blocks a UI PR.

## Worktrees

Every agent that changes source files must work in an isolated git worktree,
never in the shared main checkout at `/Users/youhaowei/Projects/DashFrame`.
Agents sharing a checkout can overwrite each other's uncommitted work.

Start feature-branch work with:

```sh
worktree=$(scripts/ensure-worktree.sh <branch-name>)
cd "$worktree"
```

The script creates or reuses `~/worktrees/dashframe/<branch-slug>`, initializes
and repairs submodules, and runs `bun install --frozen-lockfile` when first
provisioning the worktree. A reused worktree is left untouched, so local
`bun link` overrides survive. If a manifest changes, refresh dependencies
explicitly. Run `bun run build:wystack` when built `@wystack/*` output is
needed.

If provisioning fails, rerun the same command after fixing the cause; do not
improvise another checkout. A failed first run leaves a resumable worktree.

The pre-commit hook blocks non-default branches in the shared main checkout.
Set `ALLOW_MAIN_CHECKOUT_COMMIT=1` only when the environment itself provides
single-agent isolation and you knowingly own that checkout. The hook still
runs lint-staged formatting.

Remove a worktree with `scripts/remove-worktree.sh <path>`, never
`git worktree remove --force` or `rm -rf`. The guard refuses to discard
uncommitted, unpushed, stashed, or in-progress work in the parent or its
submodules. Resolve what it reports. Gitignored files are not protected, so
copy out any `.env` or local artifact you need first.

## Submodules

`libs/wystack` and `libs/stdui` are separate repositories:

- `libs/wystack` → `youhaowei/wystack`: shared identity, permissions, and
  secret-vault packages. DashFrame does not use its RPC/database runtime.
- `libs/stdui` → `youhaowei/stdui`: the `@wystack/ui-*` design system.

DashFrame consumes their built output. If `@wystack/*` imports do not resolve,
run:

```sh
git submodule update --init --recursive
bun run build:wystack
```

Branch switches do not synchronize submodules. Only `scripts/ensure-worktree.sh`
and `bun run setup` populate them; teardown still goes through
`scripts/remove-worktree.sh`.

A submodule change is a two-repository change:

1. Make the change in an isolated worktree for the submodule repository. Run
   that repository's gate, open its PR, and merge it first. DashFrame's checks
   exclude `@wystack/*` and do not validate submodule source.
2. In the DashFrame worktree, check out the merged submodule commit, stage the
   submodule path, run `bun run build:wystack`, and run `bun run check`.
3. Pin the commit that landed on the submodule's default branch. If its PR was
   squashed or rebased, do not pin the pre-merge feature commit.

Never edit a shared submodule checkout or commit only an unreviewed pin.
Parallel submodule changes need separate submodule worktrees.

## Local review gate

Before every push, and again before marking a PR ready, refresh the base:

```sh
git fetch origin main
git diff origin/main...HEAD
```

Review that exact branch diff through all three arms below. A failed check or an
unresolved finding blocks the push. CI confirms this work; it does not replace
it.

1. **Code review.** Review the full diff for correctness, security, and fit with
   surrounding code. In Claude Code use `/code-review`; elsewhere use the local
   agent runner with the second-reviewer brief below. Resolve blockers and
   consciously dismiss lower-severity findings. `/code-review ultra` is a
   user-triggered cloud review and does not replace this pass.
2. **Behavioral QA.** Exercise the changed surface through its real runtime
   path. A unit test is supporting evidence, not behavioral QA. Run desktop
   changes with `bun run dev`; for headless web testing, use the commands under
   **Run locally**. For a server, CLI, or build change, call the endpoint, run
   the command, or import the output. UI changes also require the PR screenshots
   described above.
3. **Independent review.** Have a model other than the author and first reviewer
   inspect the same diff. From the repository root, a qualifying Codex pass is:

   ```sh
   codex exec "Follow the second-reviewer brief in AGENTS.md. Do exactly what it says."
   ```

   If Codex authored the change or ran the first review, use another model. Give
   every reviewer the same diff and brief. Resolve or explicitly dismiss every
   finding; another reviewer's silence is not a dismissal.

A change confined to documentation or prose files may skip behavioral QA and
the independent review, but it still needs code review. Application source,
scripts, CI workflows, package manifests, build wiring, and comments inside
source files are executable-change territory and do not qualify.

### Second-reviewer brief

> Review `git diff origin/main...HEAD`. Read any surrounding repository code you
> need; the diff is the subject, not the limit of the evidence.
>
> Look for correctness and security bugs, race conditions, data loss or
> corruption, resource leaks, faulty error handling, authorization gaps, API
> contract mismatches, weak tests, release or build hazards, and maintainability
> risks with concrete impact. Shell scripts, workflows, comments, and docblocks
> are in scope.
>
> Treat tests as evidence of intended behavior. If a test contradicts a suspected
> bug, drop the finding or lower its confidence and explain why. Do not infer a
> contract from a helper's name. Deduplicate root causes. Report no speculative or
> low-evidence findings.
>
> For each finding, give its severity (`critical`, `high`, `medium`, or `low`),
> evidence as `path:startLine-endLine`, reasoning, reproduction, recommendation,
> why existing tests miss it, a regression test, and the minimum fix scope.
>
> Do not report these repository conventions as findings:
>
> - Bun is the package manager (`packageManager: bun@1.4.2`); Bun-only scripts and
>   documented Bun commands are intentional.
> - Some first-party packages intentionally expose a TypeScript `main` without
>   `dist` for TS-aware runtimes.

## Checks

Run the repository gate after code changes:

```sh
bun run check
```

`scripts/run-checks.mjs` runs every convention guard and then
`turbo check --filter=!@wystack/* --continue=dependencies-successful`. Each
summary line is `PASS`, `FAIL`, or `SKIP`; both `FAIL` and `SKIP` fail the gate.
Today only `check:wystack-domain-nouns` can skip, when `libs/wystack` is absent.
Initialize the submodule and rerun. Re-run an individual failure with
`bun run <check-name>`.

Formatting is separate:

```sh
bun run format:check
```

Focused commands omit convention guards, so do not substitute them for
`bun run check` when changed code may contain ticket references:

```sh
bunx turbo lint --filter='!@wystack/*'
bunx turbo test --filter='!@wystack/*'
bunx turbo build --filter='!@wystack/*'
```

Do not run unfiltered `turbo lint`: `@wystack/*` uses `oxlint`, which is not
installed here. `@dashframe/ui` intentionally runs unit tests with
`vp test run --project=unit`; its Storybook project needs Playwright browsers
that the check job does not install, so it has no current gate.

## Lint policy

The root `vite.config.ts` is the only lint configuration. Package scripts point
it at their source. Enabled rules run at `error`; a warning would not fail the
gate. `docs/audits/lint-guardrails-evaluation-2026-09-07.md` records the measured
rule choices.

- Measure a candidate rule against the repository before adopting it. Enable it
  at `error` with a note, or leave it disabled.
- Every suppression needs its reason:
  `oxlint-disable-next-line <rule> -- <why>`. Never use a blanket file-level
  disable.
- Turning off a rule requires a nearby config comment stating what it flagged
  and why that result was wrong for this codebase.

Root scripts and `vite.config.ts` are covered by `check:root-lint`, which is part
of `bun run check`.

## UI work

Read `DESIGN.md` before changing UI. `@wystack/ui-core` supplies tokens and
utilities; `@wystack/ui-react` supplies components. Both come from
`libs/stdui`, whose directory name is historical.

Use the surface system: `bg-surface-base` for the canvas,
`--surface-radius` and `--surface-inset` for geometry, and shadow-lifted panels
without borders. Do not introduce raw colors or per-surface UI forks; web and
Electron render the same UI.

For non-trivial UI, layout, or copy changes, create several materially distinct
static HTML mocks before editing production components.

## Run locally

In a checkout that was not provisioned by `scripts/ensure-worktree.sh`, run
`bun run setup` first. In an ensured worktree, build `@wystack/*` output with
`bun run build:wystack` when needed. Provision the pinned local Convex backend
once:

```sh
bun --filter @dashframe/convex-local provision
```

Startup does not download a binary or create a cloud deployment.

### Browser and headless testing

The preferred agent launcher is:

```sh
bun run dev:web:agent
```

It builds dependencies and launches the server, Portless, and Vite with a stable
hostname derived from the worktree path. Set `DASHFRAME_DEV_NAME` for a shorter
name. Inspect it with `bun run dev:web:status`.

For a fixed loopback setup, run these as separate foreground processes. The
loopback host does not need an operator token and owns the Convex child process.

```sh
cd apps/server
bun run src/index.ts --host 127.0.0.1 --port 4000 --public-origin http://127.0.0.1:3000
```

`--public-origin` names the address the browser opens. Vite rewrites `Host`
while proxying, so without it the server names the address it was reached on
instead, the client refuses the reply, and the app shows "Couldn't check
access". For the same reason bare `bun run dev` does not serve the browser
client: it passes no `--public-origin` and takes an OS-assigned port.

```sh
cd apps/web
PORT=3000 VITE_DASHFRAME_URL=http://127.0.0.1:4000 bun run dev:direct
```

Open `http://127.0.0.1:3000/`. Vite proxies `/api`, native Convex WebSockets,
and `/data` to the host. Use `dev:direct`, not the Portless wrapper at
`bun run dev`.

The server opens `~/.DashFrame/web-project`; it does not migrate older
WyStack/PGlite projects. Host-local data defaults to `~/.DashFrame/data` and
must remain outside the project directory. Override it with `--data-dir` or
`DASHFRAME_DATA_DIR`. Named credentials require `DASHFRAME_SECRET_KEY` (a
base64-encoded 32-byte key) or `DASHFRAME_SECRET_KEY_FILE`. Without one, the
server continues to run but rejects credential-bearing operations. Use
`--help` for key rotation details.

### Desktop

Run:

```sh
bun run dev
```

In a worktree, the desktop app defaults to `.data/desktop-project`, assigns an
available CDP port, and publishes the renderer, embedded API, and CDP endpoints.
Inspect it with `bun run dev:desktop:status`. Desktop needs a display; use the
browser launcher in headless environments.

Both launchers use one worktree identity. `bun run dev:info` prints it, and
`bun run dev:status` lists live and stale surface manifests in
`.data/dev-*.json`. Each manifest contains only local endpoints, owned PIDs,
and its project directory. Stop the owning foreground terminal instead of
killing a guessed shared process.
