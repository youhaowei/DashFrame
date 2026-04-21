# CLAUDE.md

Guidance for Claude Code working on DashFrame v0.2.

## What is DashFrame?

DashFrame v0.2 is a **desktop business intelligence tool** — local-first, offline-capable, zero cloud dependencies. Built as an Electron app (Bun runtime in main process) with a React renderer. Connects to local files (CSV, JSON, Parquet) or live databases (Postgres via DuckDB extension). One default project per user, stored at `~/.DashFrame/default-project/`. Artifacts (DataSource, Insight, Visualization, Dashboard) live in PGLite; imported data stored as Parquet. **No AI in v0.2** — chart suggestion is heuristic (field cardinality/type rules). License: AGPL-3.0-only.

See Notion links at end for evergreen specs (Project Model, Artifact Storage, Data Sources, Query Engine, Transport, Server Runtime, Visualization, Dashboards).

## Quick Reference

**This project uses Bun** as the package manager and runtime. Use `bun` instead of `npm`, `yarn`, or `pnpm`.

| Task           | Command                            |
| -------------- | ---------------------------------- |
| Validate all   | `bun check`                        |
| Run unit tests | `bun run test`                     |
| Filter package | `bun check --filter @dashframe/ui` |
| Storybook      | `bun storybook`                    |

**⚠️ NEVER run `bun dev`, `bun build`, or `bun start` unless explicitly requested.** User manages their own dev environment.

## Principles (3)

1. **Human-first, AI-optional** — UI is primary; AI support deferred to v0.3; every artifact is inspectable and editable
2. **Transparent and editable** — queries, datasets, charts, connections all visible; AI-built artifacts carry provenance
3. **Open and configurable** — curated data sources, any DuckDB-compatible connection string, local-only file formats

## Monorepo Structure

```
apps/
  desktop/       # Electron main (Bun runtime, native DuckDB, PGLite)
  renderer/      # Vite + TanStack Router + React 19 (render-only)
  server/        # `dashframe serve` Bun CLI (stub; connects via WyStack RPC)
packages/
  eslint-config/ # Shared ESLint 9 flat config
  <others>       # (populated as needed)
libs/
  stdui/         # Submodule → github.com/youhaowei/stdui (design system)
  wystack/       # Submodule → @wystack/db, @wystack/rpc, @wystack/client
docs/
  architecture.md     # v0.2 architecture (valid)
  backend-architecture.md  # LEGACY — describes v0.1 Dexie backend (skip)
  ui-components.md    # Component inventory (valid)
  specs/              # Feature specs
```

**stdui submodule discipline**:

- Commit + push submodule first, then DashFrame pointer
- Check for dirty submodules before committing: `git submodule foreach --quiet 'if [ -n "$(git status --porcelain)" ]; then echo "$sm_path has uncommitted changes"; fi'`
- Pre-push hook enforces module-before-main order

## Architecture at a Glance

**Data Model**: DataSource → Insight → Visualization → Dashboard (flat, no Model entity for joins)

**Storage Split**:

- **PGLite** (via `@wystack/db`): All artifacts (project metadata, secrets table, DataSource, Insight, Visualization, Dashboard definitions)
- **Parquet**: Imported data at `project/data/sources/<id>.parquet` (CSV/JSON/Parquet/Notion parsed on import)
- **Postgres**: Queried live via DuckDB's postgres extension (no cache)

**Runtime**:

- **Main process**: Bun + native DuckDB (via `@duckdb/node-api`) + query execution
- **Renderer**: Plain React + Zustand (no native DB, query results cross IPC)

**Transport** (WyStack):

- Single RPC surface, JSON frames in v0.2 (no Arrow)
- Adapters: Electron IPC (desktop) + WebSocket (standalone `dashframe serve` + web client)
- Subscription-optional: one method, call-once or subscribe based on caller
- **All writes through API** — hand-editing artifacts on disk unsupported; validation + reactivity at DB layer

**Secrets**: AES-256-GCM ciphertext in `secrets` table. Key stored in OS keychain (`@napi-rs/keyring`) for Electron, `DASHFRAME_PROJECT_KEY` env var for server. No master password.

**Chart Types (v0.2)**: Bar, Line, Area, Scatter, KPI/Number card. Heatmap → v0.2.1, Histogram/Box/Pie → v0.2.2. 5-core heuristic (field cardinality/type rules), not AI.

**Grooming Defaults** (row cap 10k when limit null, join fingerprint source-id-aware, live Postgres×Parquet joins warn >100k Postgres-side rows, HAVING accepts alias or restated expr, tagged errors `connection|sql|validation|transport`, exact cardinality from result payload).

## Adding New Stuff

**New data source/connector**:

1. Create package `packages/connector-<kind>/src/` with schema + parser/fetcher
2. Register with server-core plugin registry
3. Add Notion spec if user-facing

**New chart type**:

1. Update visualization package (encoder + Vega-Lite spec template)
2. Update heuristic suggestion rules (field cardinality thresholds)
3. Test with 5 sample datasets

**New artifact type**:

1. Drizzle schema addition in packages using `@wystack/db`
2. Migration via WyStack API (not hand-edited)
3. Zustand store + hooks for renderer

## Critical Gotchas

### stdui Submodule (Import Discipline)

**Always import from @stdui/react, never node_modules/stdui directly.**

```typescript
import { Button, Card } from "@stdui/react";
import { SearchIcon } from "@stdui/icons";
import { StduiProvider, useTheme } from "@stdui/react/theme";
```

Token naming: semantic tokens (`bg-neutral-bg`, `text-neutral-fg`), not shadcn naming.

### Project Folder (`~/.DashFrame/default-project/`)

**Dotfile-at-home layout**:

- Avoids accidental iCloud/OneDrive sync of user Documents
- Contains `artifacts.db` (PGLite) + `data/sources/<id>.parquet`
- `.meta.json` removed — project metadata now in `project_meta` table inside PGLite
- One source of truth principle: all writes via WyStack API, no hand-editing

### PGLite is Truth

- All artifact definitions live as rows in `artifacts.db`
- Hand-editing files on disk is NOT supported (will cause desync)
- Schema defined via Drizzle; changes require migration
- WyStack's SQL reactivity drives UI updates

### Bun Main Process

- Main process runs under Bun, not Node
- Native deps (`@duckdb/node-api`, `@napi-rs/keyring`) require Bun compatibility (verified via spike)
- Renderer is plain JS/React (can use any bundler)

### No AI in v0.2

- Chart suggestions are heuristic (field cardinality/type)
- No pi-agent, no LLM calls, no BYOK, no obfuscation pipeline
- v0.3+ will add AI assistance
- "Human-first, AI-optional" means shipped v0.2 is usable without AI

### Secrets Management

- Stored as AES-256-GCM ciphertext in `secrets` table (per-row nonce)
- One 256-bit project encryption key per project
- Electron: stored in OS keychain via `@napi-rs/keyring`
- Server: read from `DASHFRAME_PROJECT_KEY` env var (base64)
- **No master password, no recovery story** — lost key = re-enter secrets
- Linux without Secret Service daemon: clear error with env-var escape hatch

## State Management

**Zustand + Immer** (renderer-side). Zustand stores subscribe to WyStack queries; mutations dispatch via RPC.

**Import from app-layer store files, not backend directly** — allows swapping transport.

## Testing

**Vitest** for unit/integration. No Playwright E2E in v0.2 (removed during bootstrap).

```bash
bun run test                              # All unit tests
bun run test:coverage                     # With coverage report
bun run test:coverage --filter @dashframe/ui  # Single package
```

**80% coverage target.** Priority: data operations (query builders, converters), business logic, React hooks. UI components lower priority.

**Test structure**: Colocated `*.test.ts` / `*.test.tsx`, nested `describe` blocks, "should ..." names.

## UI Components

Use `@stdui/react` for standard components (Button, Card, Dialog, etc.), `@stdui/icons` for icons, `@dashframe/ui` for DashFrame-specific patterns.

**Design tokens**:

- **Spacing**: `p-4` (compact), `p-6` (standard), `p-8` (spacious)
- **Border radius**: `rounded-2xl` (main cards), `rounded-xl` (nested), `rounded-full` (badges)
- **Icon sizing**: `h-4 w-4` (inline text), `h-5 w-5` (standalone)
- **No UPPERCASE text** — sentence case (except acronyms like CSV, API)

Run `bun storybook` to browse stdui components interactively.

## Before Committing

```bash
bun check  # Runs lint + typecheck + format check
bun run test:coverage  # Unit tests with coverage
```

Check for dirty submodules:

```bash
git submodule foreach --quiet 'if [ -n "$(git status --porcelain)" ]; then echo "$sm_path has uncommitted changes"; fi'
```

## Naming Conventions

- **User-facing**: `DashFrame` (PascalCase)
- **Packages**: `@dashframe/*` (lowercase scope)
- **Storage keys**: `dashframe:*` (lowercase prefix)

## Relevant Documentation

**Evergreen Notion specs** (v0.2 locked):

- [Principles](https://www.notion.so/342d48ccaf54816a8658f2fadee84359) — timeless values
- [Vision](https://www.notion.so/342d48ccaf54814c91a6f5e0b559a52e) — long-term arc (v0.2 → v1.0 GA)
- [PRD v0.2](https://www.notion.so/342d48ccaf5481589e21e8678cd6f8ce) — current scope
- [Architecture Overview](https://www.notion.so/342d48ccaf5481408324cc4d4c5b4f17) — system design
- Project Model, Artifact Storage, Data Sources, Query Engine, Transport, Server Runtime, Visualization, Dashboards specs

**In-repo docs**:

- `docs/architecture.md` — v0.2 architecture (valid)
- `docs/ui-components.md` — component inventory
- `docs/specs/` — feature specs (reference only; new specs in Notion)

**Legacy** (v0.1 web, not maintained):

- `docs/backend-architecture.md` — describes Dexie/tRPC, now obsolete; skip unless understanding old patterns

## Rules

- **Dev servers**: worktrees free; ask before using main repo
- **Git topology**: short-lived branches off main; never delete archive refs (`archive/web-v0.1-*`)
- **Destructive actions**: require explicit user approval
- **Package additions**: check latest version before installing
