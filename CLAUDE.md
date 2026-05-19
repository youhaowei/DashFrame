# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**This project uses Bun** as the package manager and runtime. Use `bun` instead of `npm`, `yarn`, or `pnpm`.

| Task            | Command                             |
| --------------- | ----------------------------------- |
| Validate all    | `bun check`                         |
| Run unit tests  | `bun run test`                      |
| Run E2E tests   | `cd e2e/web && bun run test:e2e`    |
| Run desktop app | `bun run dev:desktop`               |
| Filter package  | `bun check --filter @dashframe/web` |
| Storybook       | `bun storybook`                     |

**⚠️ NEVER run `bun build` or `bun dev` unless explicitly requested.** User manages their own dev environment.

**Planning style**: Concise, no full code examples, only core changes. Name plans by feature.

## Commands

```bash
bun check           # lint + typecheck + format (use this before committing)
bun typecheck       # TypeScript only
bun lint            # ESLint 9 (flat config)
bun format          # Prettier write
bun format:check    # Prettier check (CI-safe)
bun check --filter @dashframe/web  # Target specific package
```

## Core Architecture

**See `docs/architecture.md` for complete architecture details.**
**See `docs/backend-architecture.md` for backend plugin system.**

### Key Concepts

- **DataFrame as central abstraction**: `CSV/Notion → DataFrame → Vega-Lite → Chart`
- **Pluggable backend architecture**: Env-based backend selection
- **Functional utilities**: For data conversion and transformation or utilities, prefer pure functions over classes for simplicity and testability.
- **OOP Design**: Use classes and inheritance when make sense for entities with behavior, for encapsulation and code organization.
- **Entity hierarchy**: DataSource → Insight → DataFrame → Visualization
- **tRPC for APIs**: Server-side proxy to avoid CORS issues (web app only — the desktop app uses Electron IPC)

### Backend Plugin System

DashFrame uses **build-time alias resolution** for backend selection:

```bash
# IndexDB backend with Dexie (default)
NEXT_PUBLIC_STORAGE_IMPL=dexie

# Custom backend implementations
NEXT_PUBLIC_STORAGE_IMPL=custom
```

**How it works**:

1. `@dashframe/core/backend.ts` exports from stub package `@dashframe/core-store`
2. Vite aliases `@dashframe/core-store` → `@dashframe/core-${NEXT_PUBLIC_STORAGE_IMPL}` (configured in `apps/web/vite.config.ts`)
3. TypeScript resolves `@dashframe/core-store` as a normal workspace package (no path aliases needed)
4. Only the selected backend is bundled; unused backends are tree-shaken away

**Package structure**:

- `@dashframe/types` - Pure type contracts (repository interfaces)
- `@dashframe/core-dexie` - Dexie/IndexedDB implementation (default)
- `@dashframe/core-store` - Stub package (re-exports default backend for type resolution)
- `@dashframe/core` - Re-exports from aliased backend (no direct dependencies)

**Components import from `@dashframe/core` and remain backend-agnostic**. Switching backends requires only env var + rebuild.

See `docs/backend-architecture.md` for full details on creating custom backends.

### Adding New Data Sources

1. Create package in `packages/<source>/` with converter function
2. Add tRPC router in `apps/web/lib/trpc/routers/<source>.ts`
3. Extend `apps/web/lib/stores/` (types + actions)
4. Update the data sources UI components in `apps/web/components/data-sources/`

## Desktop App (Electron)

The desktop app is the primary surface (v0.2 reboot). Three-process model:

- **Main** (`apps/desktop/src/main.ts`) — Node.js process. Owns the filesystem and project DB lifecycle via `@dashframe/server-core`. Registers `ipcMain` handlers.
- **Preload** (`apps/desktop/src/preload.ts`) — context-isolated bridge. Exposes a narrow `window.dashframe` API; no direct DB or filesystem access.
- **Renderer** (`apps/renderer/`) — React + Vite + TanStack Router UI. No Node.js access; reaches the main process only through `window.dashframe`.

**IPC contract**: `@dashframe/desktop-types` defines the `DashFrameApi` interface shared by preload and renderer. Add a new IPC call there first, then implement it in both `main.ts` (handler) and `preload.ts` (bridge).

**Boundary rule**: `contextIsolation: true`, `nodeIntegration: false`. The renderer **cannot** import `@dashframe/server-core` — it is bundled into the main process only.

**Project storage**: `server-core` uses PGLite + Drizzle. `openProject()` initializes the artifact DB at `~/.DashFrame/<name>/artifacts.db`.

**Dev**: `bun run dev:desktop` runs `apps/desktop/scripts/dev.mjs` — builds `server-core`, bundles main + preload (esbuild), starts the renderer Vite server, then launches Electron with `DEV_URL`.

**Build**: esbuild — `main.ts` → ESM, `preload.ts` → CJS.

## tRPC for External APIs

**Why**: External APIs (like Notion) block direct browser requests with CORS.

**Solution**: Server-side tRPC routers proxy API calls.

**Flow**: `Component → tRPC hook → API route → tRPC router → External API`

**Config**: Uses `superjson` transformer for Date, Set, Map support. See `lib/trpc/init.ts` and `routers/` for implementation.

## Monorepo Structure

```
apps/
  desktop/                 # Electron main + preload (project lifecycle, IPC, windowing)
  renderer/                # Electron renderer UI — React + Vite + TanStack Router
  server/                  # Headless CLI stub (`dashframe serve`, v0.2 — not yet implemented)
  web/                     # Standalone web SPA — Vite + TanStack Router
libs/
  stdui/                   # Git submodule → github.com/youhaowei/stdui.git
                           # Design system: primitives, tokens, theme provider
packages/
  types/                   # Pure type contracts (zero deps)
  core/                    # Backend selector (env-aliased)
  core-store/              # Stub package for backend type resolution
  core-dexie/              # Dexie/IndexedDB backend (default)
  server-core/             # Project + artifact DB lifecycle (PGLite + Drizzle)
  desktop-types/           # IPC contract shared by preload + renderer
  engine/                  # Abstract query engine interfaces
  engine-browser/          # DuckDB-WASM + IndexedDB engine
  connector-notion/        # Notion API connector
  connector-local/         # Local file connector
  csv/                     # CSV connector
  json/                    # JSON → Arrow transform
  visualization/           # Vega-Lite chart rendering
  ui/                      # DashFrame-specific components (VirtualTable,
                           #   SortableList, Breadcrumb, ItemSelector, chart-icons)
                           # Includes Storybook for component development
  transport/               # Reserved (empty) — future renderer↔server transport
  app/                     # Reserved (empty)
  eslint-config/           # Shared ESLint 9 flat config
```

### stdui Submodule

`libs/stdui/` is a **git submodule** providing the design system. Import directly:

- **Components**: `import { Button, Card } from "@stdui/react"`
- **Icons**: `import { SearchIcon } from "@stdui/icons"`
- **Theme**: `import { StduiProvider, useTheme } from "@stdui/react/theme"`
- **DashFrame-specific**: `import { VirtualTable, SortableList } from "@dashframe/ui"`

**Token naming**: stdui uses semantic tokens (`bg-neutral-bg`, `text-neutral-fg`, `bg-palette-primary`), not shadcn naming (`bg-background`, `text-foreground`, `bg-primary`).

**Committing submodule changes**: The submodule has its own git history. When modifying files in `libs/stdui/`:

```bash
# 1. Commit & push inside the submodule
cd libs/stdui
git add <files>
git commit -m "fix: ..."
git push origin main

# 2. Back in DashFrame, update the submodule pointer
cd /Users/youhaowei/Projects/DashFrame
git add libs/stdui
git commit -m "chore(deps): update stdui submodule"
```

**Always push the submodule before pushing DashFrame.** The pointer is a promise — the remote must have the commit it references. A `pre-push` hook enforces this, but proactively follow the order: push stdui first, then push DashFrame. Never leave the submodule pointer dirty.

**Before committing in DashFrame**, check for dirty submodules:

```bash
git submodule foreach --quiet 'if [ -n "$(git status --porcelain)" ]; then echo "$sm_path has uncommitted changes"; fi'
```

If any submodule has uncommitted changes, commit and push them first (step 1 above), then commit the pointer update in DashFrame. This applies to `/commit`, manual commits, and any workflow that stages files.

**Critical**: Packages export TypeScript source directly (`main: "src/index.ts"`), not compiled JS. Web app uses TypeScript path mappings for hot reload. See `tsconfig.json` files.

## State Management & Persistence

**Backend-agnostic data layer**. Currently uses **Dexie (IndexedDB)** for local-first deployment. Data model uses flat entities:

- **DataSource** - Connector type (e.g., "csv", "notion") + connection config
- **DataTable** - Schema, fields, metrics. Links to DataSource
- **Insight** - Analytics definition with selected fields, metrics, filters
- **Visualization** - Vega-Lite spec. Links to Insight
- **Dashboard** - Layout of visualization panels

**Import pattern**: Always import hooks from `@dashframe/core` (not `@dashframe/core-dexie` directly):

```typescript
import { useDataSources, useDataSourceMutations } from "@dashframe/core";
```

This keeps components backend-agnostic. The backend implementation is selected via the `NEXT_PUBLIC_STORAGE_IMPL` env var.

## Critical Gotchas

### Naming Conventions

- **User-facing**: `DashFrame` (PascalCase)
- **Packages**: `@dashframe/*` (lowercase scope)
- **Storage keys**: `dashframe:*` (lowercase prefix)

### Tailwind CSS v4

Uses PostCSS-only config via `@source` directives in `globals.css`. **Don't** create `tailwind.config.js`.

### Rate Limiting in tRPC

All tRPC endpoints calling external APIs use rate limiting. Use `rateLimitedProcedure` (default 10 req/min) or `rateLimitMiddleware()` for custom limits. See `apps/web/lib/trpc/rate-limiter.ts`.

- **Testing**: Always call `destroyAllRateLimiters()` in test cleanup (in-memory, per-instance)
- **Local dev**: All requests share 'unknown' IP identifier

### Other Gotchas

- **Notion API Keys**: Stored in IndexedDB. Treat as sensitive - don't commit to version control.
- **Turborepo Cache**: Run `turbo build --force` if seeing stale builds

## Development Best Practices

### When Modifying Packages

1. Make changes in `packages/*/src/`
2. TypeScript watch mode auto-compiles (if a dev server is running)
3. Vite HMR picks up changes immediately
4. No manual rebuild needed

### When Adding Features

1. **Write a spec first** in `docs/specs/<feature-name>.md` (see `create-visualization-flow.md` as reference)
2. Check `docs/architecture.md` for alignment
3. Add tRPC router if calling external APIs (avoid CORS)
4. Run `bun check` before committing

### UI Component Guidelines

**See `docs/ui-components.md` for full inventory.** Use `bun storybook` to browse.

**Import sources** (see stdui Submodule section above for examples):

- `@stdui/react` — standard UI (Button, Card, Dialog, Panel, etc.)
- `@stdui/icons` — icons (SearchIcon, DeleteIcon, etc.)
- `@dashframe/ui` — DashFrame-specific (VirtualTable, SortableList, ItemSelector, Breadcrumb, chart-icons, field wrappers)

**All UI on pages MUST use stdui or `@dashframe/ui` components.** Add missing components to stdui or the UI package first.

**Design tokens**:

- **Spacing**: `p-4` (compact), `p-6` (standard), `p-8` (spacious)
- **Border radius**: `rounded-2xl` (main cards), `rounded-xl` (nested), `rounded-full` (badges)
- **Icon sizing**: `h-4 w-4` (inline text), `h-5 w-5` (standalone)
- **No UPPERCASE text** — sentence case everywhere (except acronyms)

**Component extraction**: If a pattern appears 3+ times → extract to `packages/ui/src/components/` → export from `index.ts`

### Architecture Principles

- **DataFrame is the contract**: All sources convert to it, all visualizations consume it
- **Zustand + Immer**: State management with automatic persistence
- **Type safety everywhere**: Leverage TypeScript strict mode
- **Fowler Coding Style**: Readability, maintainability, simplicity
- **Test driven development**: Write tests for critical logic. Features with specs need test plans.
- **Detect Code Smells Early**: Watch for complexity, duplication, poor separation. Flag tech debt.

## Testing

**Vitest** for unit/integration, **Playwright** for E2E. **80% coverage target.**

```bash
bun run test                              # All unit tests
bun run test:coverage                     # With coverage report
bun run test:coverage --filter @dashframe/types  # Single package
cd e2e/web && bun run test:e2e            # E2E tests
cd e2e/web && bun run test:ui             # Playwright UI mode
```

### Testing Priority

1. **HIGH**: Data operations, business logic (converters, chart suggestions)
2. **MEDIUM**: React hooks, utilities
3. **LOW**: UI components (prefer E2E)

### Unit Test Conventions

- Colocated with source: `*.test.ts` / `*.test.tsx`
- Nested `describe` blocks, `"should ..."` test names
- Mock factories for reusable test data

### Common Mocks

```typescript
vi.mock("@dashframe/core", () => ({
  useDataSources: () => [],
  useInsightMutations: () => ({ create: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
```

### E2E Custom Fixtures

E2E tests use custom fixtures from `e2e/web/lib/test-fixtures.ts`:

- `homePage()` — navigate to home, verify loaded
- `uploadFile(fileName)` — upload from `e2e/web/fixtures/`
- `uploadBuffer(name, content, mimeType)` — upload in-memory content
- `waitForChart()` — wait for chart SVG to render

```typescript
import { expect, test } from "../lib/test-fixtures";

test("upload CSV and create chart", async ({
  homePage,
  uploadFile,
  waitForChart,
}) => {
  await homePage();
  await uploadFile("sales_data.csv");
  await waitForChart();
});
```
