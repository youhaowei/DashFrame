# CLAUDE.md

Guidance for Claude Code working on DashFrame.

DashFrame is moving from the working v0.1 web app toward the v0.2 desktop
architecture. Preserve the v0.1 product surface unless a Notion v0.2 spec
explicitly replaces it.

## Quick Reference

This project uses Bun as the package manager and runtime. Use `bun` instead of
`npm`, `yarn`, or `pnpm`.

| Task            | Command                          |
| --------------- | -------------------------------- |
| Validate all    | `bun check`                      |
| TypeScript only | `bun typecheck`                  |
| Lint            | `bun lint`                       |
| Unit tests      | `bun run test`                   |
| E2E tests       | `cd e2e/web && bun run test:e2e` |
| Desktop dev     | `bun dev:desktop`                |
| Storybook       | `bun storybook`                  |

Dev server discipline: do not blindly start long-running dev/watch commands.
First check whether the user already has a dev server or Electron session
running. Avoid clobbering it, and use an alternate port/session when needed.
Scoped validation commands are fine.

## Current Architecture Direction

Use the Notion v0.2 specs as the source of truth for current architecture. The
legacy local architecture snapshot was moved to Notion as deprecated history and
`docs/architecture.md` should not be recreated as a canonical source.

Current v0.2 direction:

- Desktop target: Electron main process plus Vite/React renderer.
- Web target: keep the existing v0.1 web/DuckDB-WASM path available while v0.2
  desktop work is revived on top of it.
- Artifact DB: PGLite with DashFrame-owned Drizzle schemas and migrations.
- Bulk data: project-owned Parquet files plus `contentHash` for imported
  CSV/JSON/Parquet/Notion data.
- Query engine: DuckDB-WASM remains the browser/local tier; Electron uses native
  DuckDB through the main process data path.
- WyStack: use `wystack-server` primitives for metadata/reactivity/transport
  boundaries. Do not depend on a `wystack-db` wrapper layer.
- `dashframe serve`: not a v0.2 deliverable. Keep future compatibility only.
- Dashboards: visualization tiles and text/markdown tiles are in scope. Text and
  markdown already exist in v0.1 and should be ported forward, not deferred.
- AI/BYOK: out of scope for v0.2.

## Notion Source Of Truth

- [Principles](https://www.notion.so/342d48ccaf54816a8658f2fadee84359)
- [Vision](https://www.notion.so/342d48ccaf54814c91a6f5e0b559a52e)
- [PRD v0.2](https://www.notion.so/342d48ccaf5481589e21e8678cd6f8ce)
- [Architecture Overview](https://www.notion.so/342d48ccaf5481408324cc4d4c5b4f17)
- Project Model, Artifact Storage, Data Sources, Query Engine, Transport, Server
  Runtime, Visualization, and Dashboards specs in Notion.
- Deprecated web architecture snapshot:
  [Deprecated - DashFrame Web Architecture](https://www.notion.so/34ed48ccaf5481a38fe9c1b39ac362ec)

In-repo docs:

- `docs/ui-components.md` - component inventory and UI reuse guidance.
- `docs/specs/` - legacy/reference specs only; new user-facing v0.2 specs go in
  Notion.
- `docs/backend-architecture.md` - legacy v0.1 Dexie/tRPC backend notes. Use
  only for historical context.

## Monorepo Structure

```text
apps/
  web/                      # v0.1 Next.js app to preserve/revive
  desktop/                  # v0.2 Electron main/preload
  renderer/                 # v0.2 Vite/React renderer shell
libs/
  stdui/                    # Git submodule: design system
  wystack/                  # Git submodule: server/client/runtime primitives
packages/
  types/                    # Pure type contracts
  core/                     # Backend selector
  core-dexie/               # v0.1 IndexedDB backend
  engine/                   # Abstract engine interfaces
  engine-browser/           # DuckDB-WASM + IndexedDB
  connector-local/          # Local file connector
  connector-notion/         # Notion API connector
  visualization/            # Vega/VGPlot chart rendering
  ui/                       # DashFrame-specific UI
  server-core/              # v0.2 PGLite/Drizzle project/artifact DB
  eslint-config/            # Shared ESLint config
```

## Submodules

`libs/stdui/` provides the design system. Import directly:

- Components: `import { Button, Card } from "@stdui/react"`
- Icons: `import { SearchIcon } from "@stdui/icons"`
- Theme: `import { StduiProvider, useTheme } from "@stdui/react/theme"`
- DashFrame-specific components: `import { VirtualTable } from "@dashframe/ui"`

Before committing in DashFrame, check for dirty submodules:

```bash
git submodule foreach --quiet 'if [ -n "$(git status --porcelain)" ]; then echo "$sm_path has uncommitted changes"; fi'
```

Always push submodule commits before pushing the DashFrame pointer update.

## v0.1 Web Notes

The v0.1 web app is still valuable and should not be deleted as part of v0.2
bootstrap work.

- DataFrame is the central abstraction: source data becomes a DataFrame, then
  visualizations consume it.
- Existing persistence uses Dexie/IndexedDB through the backend-agnostic
  `@dashframe/core` surface.
- Components should import hooks from `@dashframe/core`, not directly from
  `@dashframe/core-dexie`.
- DuckDB-WASM packages and tests are part of the preserved baseline.
- Existing dashboard text/markdown widgets are part of the preserved baseline.

## v0.2 Server-Core Notes

- Artifact definitions live in `artifacts.db`.
- `project_meta` is a singleton row; schema version must be validated on open.
- Imported source data should be materialized as project-owned Parquet/columnar
  files with a content hash.
- Secrets are artifact rows encrypted with a key stored outside the project
  folder, normally via OS keychain in Electron.
- Postgres connects per query for v0.2. Pooling is deferred until there is
  performance evidence.
- All writes should go through APIs; hand-editing project files is unsupported.

## UI Guidelines

Check `docs/ui-components.md` before implementing UI.

- Use `@stdui/react` for standard UI.
- Use `@stdui/icons` for icons.
- Use `@dashframe/ui` only for DashFrame-specific reusable components.
- Add missing primitives to stdui or the UI package before duplicating patterns.
- No uppercase UI text except acronyms.

## Testing

Vitest is used for unit/integration tests, Playwright for E2E.

```bash
bun run test
bun run test:coverage
bun run test:coverage --filter @dashframe/types
cd e2e/web && bun run test:e2e
```

Testing priority:

1. Data operations and business logic.
2. React hooks and utilities.
3. UI components, preferably through E2E for user workflows.

## Rules

- Plan first for non-trivial work.
- Preserve v0.1 behavior unless a v0.2 Notion spec explicitly changes it.
- Do not reset, force-push, or delete branches without explicit user approval.
- Never delete archive refs such as `archive/web-v0.1-*`.
- Check latest package versions before adding new dependencies.
- Run relevant scoped checks before reporting completion.
