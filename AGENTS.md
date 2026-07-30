# AGENTS.md

DashFrame is a local-first BI tool (import data → DuckDB → charts). It ships as
two surfaces of the same UI (`packages/app`): an Electron **desktop** app and a
browser **web** app, both backed by the same Hono HTTP+WS server code.

Package manager is **Bun** (pinned `bun@1.3.5`); orchestration is Turborepo.
`bun` is on `PATH` (`/usr/local/bin/bun` in the cloud VM, Homebrew locally).

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
     (relevant states, light + dark) — see `CLAUDE.md` → **Pull requests**.

3. **Second reviewer.** The same diff, read again by a model other than the one
   that wrote the change — the requirement is the second, independent read, not
   a particular vendor. We route this to Codex: from the repo root, run
   `codex exec` with the brief below as its prompt — the brief tells the reviewer
   to take the diff itself, so nothing else needs wiring up. Any equivalent
   invocation counts: a second model in your own editor or agent runner, given
   the same diff and the same brief. Land or consciously dismiss every finding;
   an open finding is a push-blocker, and "the other reviewer didn't flag it" is
   not a dismissal.

**Narrow exception.** A change that touches no executable artifact — prose,
comments, and documentation only — may skip QA and the second reviewer, but
still gets the code-review pass. Scripts, CI workflows, package manifests, and
build wiring are executable: changing them does not qualify, even when no
application source is touched.

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
submodule checkout revert each other exactly like the parent repo (`CLAUDE.md` →
worktree isolation). Trust the submodule PR's own remote state as the source of
truth for what has landed.

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
worktrees via `scripts/ensure-worktree.sh`, per `CLAUDE.md`). A Cursor Cloud
agent works on its branch directly in the single main checkout, so that guard
would block every commit. Commit with the documented bypass:
`ALLOW_MAIN_CHECKOUT_COMMIT=1 git commit ...`. The hook still runs `lint-staged`
(prettier) on staged files.
