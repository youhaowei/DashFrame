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

### Lint / test / build

Use the project's own gate `bun check` (or filter `--filter='!@wystack/*'`).
The vendored `@wystack/*` submodule packages lint with `oxlint`, which is not
installed, so a raw `bun run lint` / `turbo lint` fails on `@wystack/ui`. The
project deliberately excludes them (`bun check` = `turbo check --filter=!@wystack/*`).

- Lint: `bunx turbo lint --filter='!@wystack/*'`
- Test: `bunx turbo test --filter='!@wystack/*'`
- Build: `bunx turbo build --filter='!@wystack/*'`
