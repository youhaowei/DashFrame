# DashFrame

[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/youhaowei/DashFrame)](https://coderabbit.ai)

DashFrame is a local-first business intelligence tool focused on the data → chart journey: import data, query it with DuckDB, and build visualizations. It ships as **two surfaces of the same UI** (`packages/app`) — an Electron **desktop** app and a browser **web** app — both backed by the same Hono HTTP+WS server. Architecture and design docs are maintained separately (not in this repo).

## Stack

- **Electron** desktop app + **Vite/React 19** web app — one shared UI (`packages/app`)
- **Hono** HTTP+WS server (`apps/server`, `packages/server-core`) — the web app is _not_ purely client-side; it talks to this backend
- **DuckDB** for query — native (`@duckdb/node-api`) on desktop, **DuckDB-WASM** in the browser
- **WyStack** (`libs/wystack`) — the RPC/data substrate; **stdui** (`libs/stdui`) — the `@wystack/ui-*` design system (both git submodules)
- **Bun** for package management and runtime, **Turborepo** for workspace orchestration
- **Tailwind CSS v4**, **Vega-Lite** for declarative chart rendering
- Connectors for CSV, Notion, Postgres, and REST sources

## Project Layout

```text
apps/
  desktop/          # Electron shell (main process + packaging)
  renderer/         # Electron renderer entry
  web/              # Vite web app
  server/           # Standalone Hono server (`dashframe serve`)
packages/
  app/              # The shared React UI (desktop + web render the same code)
  types/            # Pure type contracts
  core/             # Client data layer / hooks
  engine/           # Abstract engine interfaces (TS-only)
  engine-browser/   # DuckDB-WASM implementation
  engine-server/    # Native DuckDB implementation
  server-core/      # Server runtime shared by apps/server and the Electron main
  connector-local/  # Local file (CSV/JSON) connector
  connector-notion/ # Notion API connector
  connector-postgres/ # Postgres connector
  connector-rest/   # REST connector
  visualization/    # Chart rendering system
  ui/               # App-local UI primitives
libs/
  wystack/          # RPC/data substrate (submodule)
  stdui/            # @wystack/ui-* design system (submodule)
```

## Naming Conventions

- Use `DashFrame` for user-facing copy, branding, React components, and TypeScript types.
- Use `dashframe` for package names, config identifiers, workspace scopes (e.g. `@dashframe/app`), directories, and persisted storage keys.
- Keep new packages under the `@dashframe/*` scope so tooling and imports remain consistent.

### Quick start

```bash
bun run setup     # init submodules, install deps, build the vendored @wystack/* packages
bun dev           # launch the Electron desktop app (embeds the server; renderer on Vite)
bun check         # lint + typecheck + tests (the project gate)
bun run test      # run all tests
```

`bun run setup` is required on a fresh clone — it initializes the `libs/wystack`
and `libs/stdui` git submodules and builds the `@wystack/*` packages the app
depends on.

### Working on the libraries

`libs/wystack` and `libs/stdui` are full clones of their own repos. Edit them
in place, on a branch, like any repo. **The one rule: the library commit must
be on its upstream before the pointer bump leaves this machine** — the
pre-push hook blocks the superproject push until it is (nothing checks at
commit time, so an early commit is fine; it just cannot be pushed), and CI
can only fetch commits that exist upstream.

- Nothing syncs submodules automatically. There is no post-checkout hook, so a
  library checkout stays on whatever branch you put it on; only
  `scripts/ensure-worktree.sh` (fresh worktrees) and `bun run setup` touch it.
- Create worktrees through `scripts/ensure-worktree.sh` — a hand-rolled
  `git worktree add` leaves `libs/` empty (nothing initializes submodules for
  you anymore), which surfaces later as a confusing
  `@wystack/*@workspace:* failed to resolve` from `bun install`. If you do
  add one by hand, run `git submodule update --init --recursive` in it.
- `git status` hides in-progress library edits (`ignore = dirty`) but still
  shows pointer differences as `modified: libs/* (new commits)`. That line has
  two possible meanings now: a pending bump you made, or a stale library
  checkout after switching branches whose pointers differ. Check with
  `git diff --submodule` before staging it; to sync a stale checkout
  deliberately, run `git submodule update -- libs/<name>`.
- `bun link` can point an `@wystack/*` package at a checkout that lives
  elsewhere, but **any `bun install` (including `bun run setup`) silently
  undoes the link** — every `@wystack/*` dependency is `workspace:*`, and
  install re-resolves it to the in-repo submodule. Re-link after installs, or
  prefer editing the submodule clone in place.
- Remove worktrees with `scripts/remove-worktree.sh <path>` — never with
  `git worktree remove --force` directly, in scripts or briefs either. The
  wrapper refuses while the worktree or a submodule holds uncommitted or
  unpushed work, a detached-HEAD commit, or a paused rebase/bisect/merge
  (both the worktree's own gitdir and each submodule's are per-worktree, so
  removal destroys detached commits, stashes, and local branches alike),
  then removes. Gitignored files (a hand-made `.env`) are the one documented
  exemption — they go with the worktree. Automation cleaning up a worktree
  it created moments ago may pass `--throwaway` to verify locally instead of
  against the remotes. Plain `git worktree remove` always balks at populated
  submodules.

### Running the app

- **Desktop (default):** `bun dev` runs `@dashframe/desktop` — the Electron shell with
  the server embedded in-process and native DuckDB.
- **Web + server:** the web app needs the backend API running, or data import fails
  with `404` on `/api/*`. Start the server on a fixed port
  (`cd apps/server && bun run src/index.ts --host 127.0.0.1 --port 4000`) and point
  the web app at it
  (`cd apps/web && VITE_WYSTACK_URL=http://127.0.0.1:4000 bun run dev:direct`).

### Packages

Each package is a TypeScript-first workspace member that exposes its source through
`src/`. Turbo treats `build` / `lint` / `typecheck` / `test` as common tasks
(`bun run build`, `bun run lint`, `bun run typecheck`, `bun run test`). See
**Project Layout** above for what each package owns.

## Using Notion Integration

DashFrame supports importing data directly from Notion databases:

1. **Create a Notion Integration**:
   - Visit [notion.so/my-integrations](https://www.notion.so/my-integrations)
   - Click "+ New integration"
   - Give it a name (e.g., "DashFrame")
   - Copy the "Internal Integration Token" (starts with `secret_`)

2. **Share a Database with Your Integration**:
   - Open the Notion database you want to import
   - Click the "..." menu in the top right
   - Select "Connections" → "Connect to" → Find your integration

3. **Import Data in DashFrame**:
   - Click the "Notion DB" tab in the web app
   - Paste your API key (it's stored in browser localStorage)
   - Click "Connect" to see your databases
   - Select a database from the dropdown
   - Choose which properties (columns) to import
   - Click "Import Data" to load into DashFrame
   - Use the "Refresh" button to sync latest data from Notion

**Security Note**: Your Notion API key is stored in browser localStorage for convenience. For production use, consider implementing OAuth or server-side key management.

## Current Status

- ✅ **Electron desktop app** with native DuckDB and an in-process server
- ✅ **Web app** backed by the same Hono server (shared `packages/app` UI)
- ✅ **Query engine** over DuckDB — native on desktop, WASM in the browser
- ✅ Route-based shell — `/data-sources`, `/insights`, `/visualizations`, `/dashboards`
- ✅ Data → Vega-Lite charts
- ✅ Connectors for CSV/JSON, Notion, Postgres, and REST sources

## Roadmap

- Richer chart customization (mark type, color palettes, formatting)
- Cross-source joins
- Named, revocable API access credentials for external clients

## Contributing

- Run `bun check` before committing to validate lint + typecheck + format
- Follow the shared ESLint + Prettier configs (`bun lint` / `bun format`)
- Architecture and design notes are maintained separately, not in this repo (release/versioning process stays in `docs/versioning.md`)
- Prefer incremental commits per module (app, packages)

## License

DashFrame is licensed under the AGPL-3.0-only license.

You are welcome to:

- use it locally or in production,
- view and modify the code,
- fork and redistribute it,
- and build open-source products with it.

You must:

- include the copyright notice and AGPL-3.0-only license in copies or substantial portions of the software.
- share derivative works under the same AGPL-3.0-only license.

See the full text in the [`LICENSE`](./LICENSE) file.

### FAQ

**Can I run DashFrame locally for my personal projects or learning?**  
Yes — the AGPL-3.0-only License permits personal and educational use.

**Can I use DashFrame at my company or in commercial products?**  
Commercial use is permitted under AGPL-3.0-only, but any modifications must be shared under the same license.

**Can I host DashFrame or offer it as SaaS?**  
Yes. You can host and integrate it, provided you share the source code of your modifications under AGPL-3.0-only and comply with any third-party API terms.

**Can I fork the project?**  
Yes. AGPL-3.0-only allows forking and redistribution as long as the license and copyright notice remain and derivative works are shared under the same license.

**Do I need to attribute DashFrame?**  
AGPL-3.0-only requires preserving the copyright notice and license. Additional attribution is appreciated but not required.
