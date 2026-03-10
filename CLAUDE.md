# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**This project uses Bun** as the package manager and runtime. Use `bun` instead of `npm`, `yarn`, or `pnpm`.

| Task           | Command                             |
| -------------- | ----------------------------------- |
| Validate all   | `bun check`                         |
| Run unit tests | `bun run test`                      |
| Run E2E tests  | `cd e2e/web && bun run test:e2e`    |
| Filter package | `bun check --filter @dashframe/web` |
| Storybook      | `bun storybook`                     |

**⚠️ NEVER run `bun build` or `bun dev` unless explicitly requested.** User manages their own dev environment.

**Planning style**: Concise, no full code examples, only core changes. Name plans by feature.

## Essential Commands

### Workspace Commands (via Turborepo + Bun)

```bash
bun dev           # Run Next.js dev + TypeScript watch mode for all packages
bun build         # Build all packages and apps (dependencies first)
bun check         # Run lint + typecheck + format check
bun typecheck     # TypeScript checks across workspace
bun lint          # ESLint 9 (flat config)
bun format        # Prettier write (formats all files)
bun format:check  # Prettier check (CI-safe, no writes)
```

Use `check` for comprehensive validation.

### Targeting Specific Packages

```bash
bun check --filter @dashframe/web
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
- **tRPC for APIs**: Server-side proxy to avoid CORS issues

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
2. Webpack aliases `@dashframe/core-store` → `@dashframe/core-${NEXT_PUBLIC_STORAGE_IMPL}`
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

## tRPC for External APIs

**Why**: External APIs (like Notion) block direct browser requests with CORS.

**Solution**: Server-side tRPC routers proxy API calls.

**Flow**: `Component → tRPC hook → API route → tRPC router → External API`

**Config**: Uses `superjson` transformer for Date, Set, Map support. See `lib/trpc/init.ts` and `routers/` for implementation.

## Monorepo Structure

```
apps/web/                  # Next.js 16 (App Router)
libs/
  stdui/                   # Git submodule → github.com/youhaowei/stdui.git
                           # Design system: primitives, tokens, theme provider
packages/
  types/                   # Pure type contracts (zero deps)
  core/                    # Backend selector (env-based)
  core-dexie/              # Dexie/IndexedDB backend
  engine/                  # Abstract engine interfaces
  engine-browser/          # DuckDB-WASM + IndexedDB
  connector-csv/           # CSV file connector
  connector-notion/        # Notion API connector
  visualization/           # Vega-Lite chart rendering
  ui/                      # DashFrame-specific components only (VirtualTable,
                           #   SortableList, Breadcrumb, ItemSelector, chart-icons)
                           # Includes Storybook for component development
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

This keeps components backend-agnostic. The backend implementation is selected via `NEXT_PUBLIC_DATA_BACKEND` env var.

## Critical Gotchas

### Vega-Lite SSR

**Must** dynamically import VegaChart with `ssr: false` - Vega-Lite uses Set objects that can't be serialized during Next.js SSR.

```typescript
const VegaChart = dynamic(() => import("./VegaChart"), { ssr: false });
```

### Naming Conventions

- **User-facing**: `DashFrame` (PascalCase)
- **Packages**: `@dashframe/*` (lowercase scope)
- **Storage keys**: `dashframe:*` (lowercase prefix)

### Tailwind CSS v4

Uses PostCSS-only config via `@source` directives in `globals.css`. **Don't** create `tailwind.config.js`.

### Rate Limiting in tRPC

**All tRPC endpoints that call external APIs use rate limiting to prevent abuse.**

- **Notion endpoints** are rate-limited per client IP (10-30 req/min depending on endpoint cost)
- **In-memory storage**: Rate limits are per-instance, not shared across deployments
- **Local development**: All requests share 'unknown' IP identifier - use `destroyAllRateLimiters()` in tests
- **Testing**: Always call `destroyAllRateLimiters()` in test cleanup to prevent state leakage

**When adding new tRPC endpoints**:

```typescript
// Default rate limiting (10 req/min)
export const myEndpoint = rateLimitedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input }) => {
    /* ... */
  });

// Custom rate limiting
export const heavyEndpoint = publicProcedure
  .use(
    rateLimitMiddleware({
      windowMs: 60000,
      maxRequests: 30,
      name: "heavyEndpoint",
    }),
  )
  .query(async ({ input }) => {
    /* ... */
  });
```

See `apps/web/lib/trpc/rate-limiter.ts` and `middleware/rate-limit.ts` for implementation details.

### Other Gotchas

- **Notion API Keys**: Stored in IndexedDB. Treat as sensitive - don't commit to version control.
- **Turborepo Cache**: Run `turbo build --force` if seeing stale builds

## Development Best Practices

### When Modifying Packages

1. Make changes in `packages/*/src/`
2. TypeScript watch mode auto-compiles (if `bun dev` running)
3. Next.js hot reload picks up changes immediately
4. No manual rebuild needed

### Before Committing

Run the check meta-command:

```bash
bun check  # Runs lint + typecheck + format
```

### When Adding Features

1. **Write a spec first**: Create a feature spec in `docs/specs/<feature-name>.md` documenting:
   - User flows and step-by-step interactions
   - UI layout and visual design
   - Decision rationale and trade-offs
   - Error handling and edge cases
   - See `docs/specs/create-visualization-flow.md` as reference example
2. Check `docs/architecture.md` for vision and architecture alignment
3. Follow functional converter pattern (no classes/inheritance)
4. Use Zustand stores for state persistence (see `apps/web/lib/stores/`)
5. Add tRPC router if calling external APIs (avoid CORS)
6. Update `README.md` only for major user-facing features

### Documentation

- Update relevant docs in `docs/` for architecture, UI components, or new features
- Add JSDoc comments for all new functions, types, and components

### UI Component Guidelines

**See `docs/ui-components.md` for comprehensive component documentation.**

Before implementing any UI changes, follow this component-first approach:

1. **Check existing components first**:
   - stdui primitives (`@stdui/react`) - Button, Card, Input, Select, Dialog, Panel, Section, etc.
   - stdui icons (`@stdui/icons`) - SearchIcon, DeleteIcon, PlusIcon, etc.
   - DashFrame-specific (`@dashframe/ui`) - VirtualTable, SortableList, ItemSelector, Breadcrumb, chart-icons, field wrappers
   - See `docs/ui-components.md` for full inventory and `bun storybook` to browse components
   - **IMPORTANT**: All UI elements on pages MUST use stdui or `@dashframe/ui` components. If a needed component doesn't exist, add it to stdui or the UI package first.

2. **Component decision principles**:
   - **Use stdui components** (`@stdui/react`) for standard UI patterns (buttons, cards, dialogs, forms, etc.)
   - **Use DashFrame components** (`@dashframe/ui`) for domain-specific patterns (ItemSelector, VirtualTable, SortableList, etc.)
   - **Create feature-specific components** for one-off, domain-specific UI
   - **Extract to shared/** when patterns emerge across multiple features

3. **Design token enforcement** (from `docs/ui-components.md`):
   - **Spacing**: `p-4` (compact), `p-6` (standard), `p-8` (spacious)
   - **Border radius**: `rounded-2xl` (main cards), `rounded-xl` (nested), `rounded-full` (badges)
   - **Icon sizing**: `h-4 w-4` (inline text), `h-5 w-5` (standalone)
   - **No UPPERCASE text** - Use sentence case everywhere (except acronyms like CSV, API)

4. **When to create reusable components**:
   - Pattern appears or will appear in 3+ places
   - Component encapsulates meaningful UI logic
   - Component has clear, semantic purpose (not just styling wrapper)
   - Add JSDoc documentation with usage examples

5. **Avoid one-off customization**:
   - Don't create custom `<div>` wrappers with Tailwind when a component exists
   - Don't duplicate component logic - extract and reuse
   - Don't break design token patterns - follow spacing/radius/icon guidelines
   - Don't skip accessibility - use semantic HTML and aria-labels

**Component extraction workflow**:

- Recognize repeated pattern → Check if component exists in `@dashframe/ui` → Extract to `packages/ui/src/components/` if used 3+ times → Document with JSDoc → Export from `packages/ui/src/index.ts`

**Storybook for UI Development**:

- Run `bun storybook` to launch Storybook at <http://localhost:6006>
- Browse all UI components with interactive examples
- Located in `packages/ui/` with stories in `src/**/*.stories.tsx`
- Configured with Storybook v10 using Next.js framework and Tailwind CSS v4

### Architecture Principles

- **DataFrame is the contract**: All sources convert to it, all visualizations consume it
- **Zustand + Immer**: State management with automatic persistence
- **Type safety everywhere**: Leverage TypeScript strict mode
- **Fowler Coding Style**: Readability, maintainability, simplicity
- **Test driven development**: Write tests for critical logic. Features with specs need test plans.
- **Detect Code Smells Early**: Watch for complexity, duplication, poor separation. Flag tech debt.

## Testing

### Test Commands

```bash
# Run all unit tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests with coverage report
bun run test:coverage

# Run coverage for specific package
bun run test:coverage --filter @dashframe/types

# Run E2E tests
cd e2e/web
bun run test:e2e

# Run E2E tests in UI mode
cd e2e/web
bun run test:ui
```

### Testing Philosophy

DashFrame follows **test-driven development** for critical logic:

- **80% coverage target**: Core functionality must have comprehensive test coverage
- **Unit tests first**: Test pure functions, utilities, and business logic in isolation
- **Integration tests**: Test how components work together (hooks, stores, data flows)
- **E2E tests**: Test critical user workflows end-to-end (CSV upload, chart creation, dashboard building)
- **Snapshot tests**: Catch visual regressions in chart configurations

### Unit Testing Patterns

DashFrame uses **Vitest** for unit and integration tests. Tests are colocated with source files using `.test.ts` or `.test.tsx` extensions.

**Key Conventions:**

- File header comment documenting what's tested
- Nested `describe` blocks (one per function)
- "should" format for test names
- Mock factories for reusable test data
- No `console.log` in committed tests
- `beforeEach`/`afterEach` for cleanup

### React Hook Testing

Use `@testing-library/react` with Vitest:

- **Always use `act()`** for state updates and async operations
- **Use `waitFor()`** for async assertions
- **Clear mocks** with `vi.clearAllMocks()` in `beforeEach`
- **Mock external deps**: `@dashframe/core`, `next/navigation`, etc.

### E2E Testing Patterns

DashFrame uses **Playwright** with custom fixtures for E2E tests.

#### E2E Directory Structure

```
e2e/web/
├── tests/                       # Test specs
│   ├── csv-to-chart.spec.ts     # CSV upload → chart workflow
│   ├── json-to-chart.spec.ts    # JSON upload → chart workflow
│   ├── error-handling.spec.ts   # Error cases (empty files, invalid formats)
│   ├── chart-editing.spec.ts    # Chart type switching
│   └── dashboard.spec.ts        # Dashboard creation & management
├── lib/
│   └── test-fixtures.ts         # Custom Playwright fixtures
├── fixtures/                    # Test data files
│   ├── sales_data.csv           # 5 rows: Date, Product, Category, Sales, Quantity
│   ├── products_data.csv        # 4 rows: Product, Price, Supplier (for joins)
│   └── users_data.json          # 5 users: id, name, email, age, department
├── support/
│   └── port-finder.ts           # Smart port allocation (3100-3120)
└── playwright.config.ts
```

#### Custom Fixtures

Tests use custom fixtures from `lib/test-fixtures.ts` for reusable actions:

```typescript
import { expect, test } from "../lib/test-fixtures";

test("upload CSV and create chart", async ({
  page,
  homePage, // Navigate to home, verify loaded
  uploadFile, // Upload from fixtures directory
  waitForChart, // Wait for chart SVG to render
}) => {
  await homePage();
  await uploadFile("sales_data.csv");
  // ... rest of test
});
```

**Available fixtures:**

- `homePage()` - Navigate to home page and verify loaded
- `uploadFile(fileName)` - Upload file from `fixtures/` directory
- `uploadBuffer(name, content, mimeType)` - Upload in-memory content (for error testing)
- `waitForChart()` - Wait for chart data and SVG to render

#### Running Tests

```bash
cd e2e/web
bun run test:e2e
```

- Builds to isolated `.next-e2e` directory
- Auto-finds available port (3100-3120)
- Local: parallel workers with separate servers for IndexedDB isolation
- CI: single worker for reliability

#### Filtering Tests

```bash
# Run specific test file
bun run test:e2e csv-to-chart

# Run tests matching pattern
bun run test:e2e --grep "upload"

# Run specific describe block
bun run test:e2e --grep "Error Handling"
```

#### E2E Best Practices

- **Use semantic selectors**: Prefer `getByRole`, `getByLabel`, `getByText`
- **Use fixtures**: Add reusable actions to `lib/test-fixtures.ts`
- **Wait for navigation**: Use `expect(page).toHaveURL()` with timeout
- **Add test data**: Place files in `fixtures/` directory
- **Use exact matching**: Add `{ exact: true }` when multiple elements match (e.g., headings)
- **Handle UI variations**: Use conditional checks when button text varies between states

#### CI Configuration

E2E in CI (`.github/workflows/ci.yml`):

- **Browser**: Chromium only
- **Workers**: Single worker (avoids port conflicts)
- **Retries**: 2 retries on failure
- **Artifacts**: Results retained 7 days

#### Debugging

```bash
bun run test:ui        # Playwright UI mode
bun run test:headed    # See browser
bun run test:debug     # Step through with debugger
bun run test:html      # HTML report after run
```

**On failure, Playwright captures**: screenshots, videos, traces (on retry).

### Snapshot Testing

Use for chart configs, complex objects, and data transformation regression testing.

```bash
bun run test chart-suggestions.snapshot.test.ts  # Generate/update snapshots
```

Snapshots saved in `__snapshots__/`. Review changes carefully in PRs.

### Coverage Requirements

**Target: 80%** for branches, functions, lines, statements (configured in `vitest.config.ts`).

**Testing priority:**

1. **HIGH**: Data operations, business logic (converters, chart suggestions)
2. **MEDIUM**: React hooks, utilities
3. **LOW**: UI components (prefer E2E)

### Mock Strategies

Common mocks for DashFrame tests:

```typescript
vi.mock("@dashframe/core", () => ({
  useDataSources: () => [],
  useInsightMutations: () => ({ create: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
```

### Test File Organization

- **Unit tests**: Colocated with source (`*.test.ts` or `*.test.tsx`)
- **E2E tests**: `e2e/web/tests/*.spec.ts`
- **Fixtures**: Custom Playwright fixtures in `e2e/web/lib/test-fixtures.ts`
- **Test data**: `e2e/web/fixtures/` (CSV, JSON files)

### Running Tests in CI

- **Unit tests**: Run on all PRs and main commits with coverage
- **E2E**: Chromium only, single worker, 2 retries, artifacts for 7 days

**Local pre-commit**: `bun check && bun run test:coverage`

### Debugging Tests

```bash
bun run test suggest-charts.test.ts   # Single file
bun run test --grep "bar chart"       # Pattern match
bun run test --ui                     # Vitest UI
cd e2e/web && bun run test:debug      # Playwright inspector
```

### Writing New Tests

1. Start with unit tests for pure functions
2. Add hook/integration tests
3. Add E2E for critical user paths
4. Run coverage to meet 80% threshold
