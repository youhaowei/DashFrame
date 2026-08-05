# AGENTS.md

DashFrame is a local-first BI tool (import data → DuckDB → charts). It ships as
two surfaces of the same UI (`packages/app`): an Electron **desktop** app and a
browser **web** app, both backed by the same Hono HTTP+WS server code.

Package manager is **Bun** (pinned `bun@1.3.5`); orchestration is Turborepo.
`bun` is on `PATH`; where it is installed from varies by machine.

## Local review gate (run before every push)

Every change is reviewed **locally before it is pushed** — CI _confirms_ a clean
result, it does not _discover_ problems. Before you push a branch, and again
before you mark any PR ready for review, run all three checks below against the
branch diff and resolve what they surface. A red result or an unresolved finding
is a **push-blocker** — do not defer it to CI or to a human reviewer.

**Refresh the base first.** Run `git fetch origin main`, then read the diff as
`git diff origin/main...HEAD`. A local `origin/main` goes stale by construction,
and a stale base silently changes what every arm below reads — the gate reviews
commits that already landed, or misses the ones it was meant to catch.

1. **Code review.** Review the full branch diff for correctness, security, and
   fit with the surrounding code. In Claude Code run `/code-review`; elsewhere,
   run your agent runner's review command over the same diff — the brief below
   works verbatim for this pass too. Fix every blocker and consciously dismiss
   lower findings — never push past an open blocker. (`/code-review ultra` is
   the heavier multi-agent cloud pass, user-triggered only; it does not replace
   this local pass.)

2. **QA — behavioral.** Exercise the _changed surface_ at runtime against what
   it is supposed to do; do not infer behavior from the diff alone. A passing
   unit test is not this arm — it proves the code does what it was written to
   do, which is the thing in question.
   - Desktop: `bun run dev` (needs a display).
   - Web + server, headless: see **Running for browser/headless testing** below.
   - No UI surface (server, CLI, build): drive the real path — call the
     endpoint, run the command, import the file — and check the result.
   - UI changes additionally require visual proof from the running app in the PR
     (relevant states, light + dark) — see `CLAUDE.md` → **Pull requests**.

3. **Second reviewer.** The same diff, read again by a model that is neither the
   one that wrote the change nor the one that ran step 1 — the requirement is a
   second, genuinely independent read, not a particular vendor. Writing in
   Claude and reviewing in Codex is the usual pairing here — from the repo root:

   ```sh
   codex exec "Follow the second-reviewer brief in AGENTS.md — the block quote
   under the '### Second-reviewer brief' heading. Do exactly what it says."
   ```

   Nothing else needs wiring up: the reviewer reads the brief out of this file,
   and the brief tells it to take the diff itself. If Codex already wrote the
   change or ran step 1, route this arm elsewhere; any second model in your own
   editor or agent runner counts, given the same diff and the same brief. Land
   or consciously dismiss every finding; an open finding is a push-blocker, and
   "the other reviewer didn't flag it" is not a dismissal.

**Narrow exception.** A change confined to documentation and other prose files
may skip QA and the second reviewer, but still gets the code-review pass.
Anything executable does not qualify — application source, scripts, CI
workflows, package manifests, build wiring — even when no application source is
touched. A comment-only edit inside a source file does not qualify either: a
comment that misstates behavior is a defect, and the second reviewer is the arm
that catches it.

### Second-reviewer brief

Pass this with the diff. These rules are the distilled prompt discipline from
Clawpatch, which this arm replaced — the finding quality came from the rules,
not from the harness around them.

> Review `git diff origin/main...HEAD`. Read whatever else in the repo you need:
> the diff is the subject, not the limit of your evidence.
>
> Look for correctness bugs; security issues; race and concurrency bugs; data
> loss or corruption; resource leaks; bad error handling; permission and auth
> gaps; API contract mismatches; missing or weak tests; release and build
> hazards; and maintainability risks with concrete impact. Shell scripts and CI
> workflow files are in scope, not just application code.
>
> Rules:
>
> - Tests are first-class evidence of intended behavior. If a test contradicts a
>   suspected bug, drop the finding or downgrade its confidence and say why.
> - Do not report behavior as a bug merely because a helper's name implies a
>   broader contract than it has.
> - Deduplicate root causes: one finding with several evidence refs, never one
>   per affected file.
> - No speculative, low-evidence findings.
> - Comments and docblocks are code. A comment that misstates real behavior is a
>   defect — report it as one.
>
> For each finding give: severity (critical/high/medium/low); evidence as
> `path:startLine-endLine`; reasoning; reproduction; recommendation; why the
> existing tests do not already cover it; a suggested regression test; and the
> minimum fix scope.
>
> Standing repo conventions — do not report these as findings:
>
> - Bun is the package manager (`packageManager: bun@1.3.5`). Bun-only scripts
>   and documented Bun commands are intended.
> - Some first-party packages deliberately ship a TypeScript `main` with no
>   `dist`, for TS-aware runtimes only. Findings that a Node consumer would
>   resolve raw TypeScript are wrong by policy.

## Lint / test / build

Use the project's own gate `bun run check`. It runs four things through
`scripts/run-checks.mjs` — the three convention guards (`check:ticket-refs`,
`check:wystack-domain-nouns`, `check:apply-commands-boundary`) and then
`check:packages`, which is `turbo check --filter=!@wystack/*` (lint + typecheck +
test, excluding the vendored submodule packages). **Every one of them runs even
when an earlier one fails**, and the summary at the end lists each result; the
overall exit code is non-zero if any failed. That is deliberate — the guards each
take under a second, and when they were chained with `&&` a one-line convention
violation hid every type error and failing test behind it. Re-run just the one
that failed with `bun run <name>`.

The `@wystack/*` packages lint with `oxlint`, which is not installed, so a raw
`bun run lint` / `turbo lint` fails on `@wystack/ui`; the project deliberately
filters them out. The per-task commands below skip the convention guards — run
`bun run check` if you touched code that might carry ticket references.

- Lint: `bunx turbo lint --filter='!@wystack/*'`
- Test: `bunx turbo test --filter='!@wystack/*'`
- Build: `bunx turbo build --filter='!@wystack/*'`

## Worktrees (all agents)

Every agent that touches source files works in an isolated git worktree — never
in the shared main checkout (`/Users/youhaowei/Projects/DashFrame`). Two agents
in the same checkout revert each other's uncommitted work.

**Bootstrap (first step in any feature-branch brief):**

```sh
worktree=$(scripts/ensure-worktree.sh <branch-name>)
cd "$worktree"
# all work happens here
```

`scripts/ensure-worktree.sh` creates `~/worktrees/dashframe/<branch-slug>`
(forward-slashes and colons in the branch name become dashes, lowercase) if not
already there, populates and heals submodule checkouts, and prints the path. If
it fails, STOP — do not improvise another location.

**Enforcement:** `.husky/pre-commit` blocks commits on a non-default branch in
the main checkout. Bypass with `ALLOW_MAIN_CHECKOUT_COMMIT=1` only when you
knowingly own that checkout — e.g. a cloud/VM agent working on its branch in
the environment's single checkout, where isolation is provided by the VM
itself. The hook still runs `lint-staged` (prettier) on staged files.

**Teardown:** remove worktrees with `scripts/remove-worktree.sh <path>` — never
`git worktree remove --force` or `rm -rf`. The guard refuses when removal would
destroy uncommitted, unpushed, stashed, or mid-operation work, in the worktree
or any of its submodules, and tells you what to do instead. A refusal means
there is work to save, not a broken script. Gitignored files are the one
exemption: the checks never see ignored content, so a hand-made `.env` or a
local build artifact is removed with the worktree — copy those out yourself.

## Git submodules (`libs/wystack`, `libs/stdui`)

Two vendored dependencies are **git submodules**, each with its own GitHub repo:

- `libs/wystack` → `youhaowei/wystack` — the RPC/data substrate (`@wystack/*`).
- `libs/stdui` → `youhaowei/stdui` — the `@wystack/ui-*` design system.

The `@dashframe/*` packages consume their **built** output, so `bun run setup`
(and CI) init the submodules and run `bun run build:wystack` before anything
else. If imports from `@wystack/*` fail to resolve, the submodule is
uninitialized or unbuilt — run `git submodule update --init --recursive && bun run build:wystack`.

**Nothing syncs submodules automatically.** There is no post-checkout hook:
switching branches never touches a submodule checkout, so a submodule parked on
its own branch stays there. Only `scripts/ensure-worktree.sh` (which also heals
half-initialized checkouts) and `bun run setup` populate them. Teardown goes through
`scripts/remove-worktree.sh` (see **Worktrees** above). See `README.md` → the
submodule workflow section for the full contract.

**Changing submodule code is a two-repo change — never edit in place and commit
only the pin.** The parent repo records a submodule as a pinned commit SHA; a
bare pin bump merges even when the submodule code it points at was never
reviewed. The workflow:

1. **Land the submodule change first, in its own repo.** Open and merge a PR in
   `youhaowei/wystack` (or `youhaowei/stdui`) against that repo's default branch.
   Run its own gate there — the parent's `bun run check` filters `@wystack/*` out
   (`--filter=!@wystack/*`), so it does **not** cover submodule code.
2. **Then bump the pin in DashFrame.** In the submodule dir, check out the merged
   commit; from the repo root, `git add libs/wystack` (or `libs/stdui`) and commit
   the new SHA. Rebuild: `bun run build:wystack`, then run the full `bun run check` so
   the parent is verified against the new substrate — a pin that merges is not the
   same as a submodule that is compatible.
3. **Re-point after the submodule merges.** If the submodule PR merged with a
   squash/rebase, the pin must point at the merged commit on the default branch,
   not the pre-merge feature SHA.

**Worktree isolation applies to submodules too.** Parallel agents that both touch
`libs/wystack` need their **own** wystack worktree each — two agents sharing one
submodule checkout revert each other exactly like the parent repo (**Worktrees** above). Trust the submodule PR's own remote state as the source of
truth for what has landed.

## Running for browser/headless testing

The web app is **not** purely client-side — it needs the backend API, or data
import fails with `404` on `/api/*` and a failed `/api/ws` WebSocket. Run two
processes:

1. API server (fixed loopback port; loopback needs no token):
   `cd apps/server && bun run src/index.ts --host 127.0.0.1 --port 4000`
   (bare `bun run dev` also works but picks an OS-assigned port). It opens a
   project at `~/.DashFrame/web-project`; host-local data (access credentials)
   goes to `~/.DashFrame/data`, overridable with `--data-dir` or
   `DASHFRAME_DATA_DIR` and required to sit outside the project directory.
   Named access credentials additionally need an encryption key — set
   `DASHFRAME_SECRET_KEY` (base64 of 32 bytes) or `DASHFRAME_SECRET_KEY_FILE`;
   without one the server still serves normally but fails closed on anything
   credential-bearing. Run `--help` for the full rotation story.
2. Web app pointed at it:
   `cd apps/web && PORT=3000 VITE_WYSTACK_URL=http://127.0.0.1:4000 bun run dev:direct`
   Open `http://127.0.0.1:3000/`. In dev the browser talks same-origin and Vite
   proxies `/api` (incl. ws) to `VITE_WYSTACK_URL`. Use `dev:direct` (plain
   Vite) rather than `bun run dev`, which wraps Vite in `portless`.

Root `bun run dev` launches the **Electron desktop** app (embeds the server
in-process, auto-starts the renderer on 5173). It needs a display, so it is not
suitable for the headless VM — prefer the web+server combo above.
