# AGENTS.md

## Cursor Cloud specific instructions

DashFrame is a local-first BI tool (import data → DuckDB → charts). It ships as
two surfaces of the same UI (`packages/app`): an Electron **desktop** app and a
browser **web** app, both backed by the same Hono HTTP+WS server code.

Package manager is **Bun** (pinned `bun@1.3.5`); orchestration is Turborepo.
`bun` is on `PATH` via `/usr/local/bin/bun`. Dependency refresh (submodules +
install + build of the vendored `@wystack/*` packages) is handled by the startup
update script; see root `package.json` `setup` for the equivalent steps.

### Running for browser/headless testing (recommended in the cloud VM)

The web app is **not** purely client-side despite the stale `README.md`. It
needs the backend API, or data import fails with `404` on `/api/*` and a failed
`/api/ws` WebSocket. Run two processes:

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

### Lint / test / build

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
