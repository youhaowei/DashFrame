# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: DO NOT Run Build or Dev Commands

**⚠️ NEVER run `bun build` or `bun dev` unless explicitly requested by the user.**

For planning, prefer concise style, don't include full code example, only core changes. Name it according to the feature being added.

The user manages their own development environment. Only run these commands if the user specifically asks you to.

## Essential Commands

### Workspace Commands (via Turborepo + Bun)

```bash
bun dev           # Run Next.js dev + TypeScript watch mode for all packages
bun build         # Build all packages and apps (dependencies first)
bun check         # Run lint + typecheck + format check
bun typecheck     # TypeScript checks across workspace
bun lint          # ESLint 9 (flat config)
bun format        # Prettier check
bun format:write  # Prettier write
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
4. Update `apps/web/components/DataSourcesPanel.tsx`

## tRPC for External APIs

**Why**: External APIs (like Notion) block direct browser requests with CORS.

**Solution**: Server-side tRPC routers proxy API calls.

**Flow**: `Component → tRPC hook → API route → tRPC router → External API`

**Config**: Uses `superjson` transformer for Date, Set, Map support. See `lib/trpc/init.ts` and `routers/` for implementation.

## Monorepo Structure

```
apps/web/                  # Next.js 16 (App Router)
packages/
  types/                   # Pure type contracts (zero deps)
  core/                    # Backend selector (env-based)
  core-dexie/              # Dexie/IndexedDB backend
  engine/                  # Abstract engine interfaces
  engine-browser/          # DuckDB-WASM + IndexedDB
  connector-csv/           # CSV file connector
  connector-notion/        # Notion API connector
  visualization/           # Vega-Lite chart rendering
  ui/                      # Shared UI components (shadcn/ui primitives + custom)
                           # Includes Storybook for component development
  eslint-config/           # Shared ESLint 9 flat config
```

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

### Other Gotchas

- **Notion API Keys**: Stored in localStorage (use OAuth in production)
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
   - `@dashframe/ui` package exports all UI components (import from `@dashframe/ui`)
   - shadcn/ui primitives (23 components) - Button, Card, Input, Select, Dialog, etc.
   - Custom shared components (11 components) - ActionGroup, ItemSelector, Panel, Toggle, etc.
   - Icons from react-icons (Lucide, Feather, Simple Icons)
   - See `docs/ui-components.md` for full inventory and `bun storybook` to browse components
   - **IMPORTANT**: All UI elements on pages MUST use components from `@dashframe/ui`. If a needed component doesn't exist, add it to the UI package first before using it in pages.

2. **Component decision principles**:
   - **Use shadcn/ui components** for standard UI patterns (buttons, cards, dialogs, forms, etc.)
   - **Use shared components** for DashFrame-specific patterns (ActionGroup, ItemSelector, Toggle, etc.)
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
- **Functional > OOP**: Converter functions, not classes with methods
- **Zustand + Immer**: State management with automatic persistence
- **Type safety everywhere**: Leverage TypeScript strict mode
- **Flowler Coding Style**: Focus on readability, maintainability, and simplicity
- **Test driven development**: Write tests for critical logic, especially when it comes to handling data. For features that has spec, make sure to include a test plan as well.
- **Detect Code Smells Early**: Watch for signs of complexity, duplication, or poor separation of concerns. Ask questions if something feels off, help user create tasks to refactor or improve code quality if found tech debt that might not be directly related to the feature being implemented.

## Testing

### Test Commands

```bash
# Run all unit tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with coverage report
bun test:coverage

# Run coverage for specific package
bun test:coverage --filter @dashframe/types

# Run E2E tests
cd e2e/web
bun test

# Run E2E tests in UI mode
cd e2e/web
bun test:ui

# Generate E2E step definitions (BDD)
cd e2e/web
bun bddgen
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

#### Basic Structure

```typescript
/**
 * Unit tests for encoding-helpers module
 *
 * Tests cover:
 * - fieldEncoding() - Creating field encoding strings
 * - metricEncoding() - Creating metric encoding strings
 * - parseEncoding() - Parsing encoding strings
 */
import { describe, expect, it } from "vitest";
import { fieldEncoding, metricEncoding } from "./encoding-helpers";

describe("encoding-helpers", () => {
  describe("fieldEncoding()", () => {
    it("should create field encoding with correct format", () => {
      const result = fieldEncoding("field-id");
      expect(result).toBe("field:field-id");
    });

    it("should handle edge cases", () => {
      // Test edge cases, errors, validation
    });
  });
});
```

#### Key Conventions

1. **File header comment**: Document what functions/features are tested
2. **Nested describe blocks**: One per function/feature, organize related tests
3. **Clear test names**: Use "should" format describing expected behavior
4. **Mock factories**: Create reusable factory functions for test data
5. **No console.log**: Remove debugging statements before committing
6. **Test isolation**: Use `beforeEach`/`afterEach` for cleanup

#### Mock Data Factories

Create reusable factories to reduce boilerplate:

```typescript
/**
 * Helper to create a mock NumberAnalysis
 */
function createNumberColumn(name: string, options?: {
  hasVariance?: boolean;
  uniqueCount?: number;
}): ColumnAnalysis {
  return {
    name,
    type: "number",
    semantic: "measure",
    hasVariance: options?.hasVariance ?? true,
    uniqueCount: options?.uniqueCount ?? 100,
    // ... other required fields
  };
}
```

### React Hook Testing Patterns

Use `@testing-library/react` for testing React hooks:

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockCreate = vi.fn();
vi.mock("@dashframe/core", () => ({
  useInsightMutations: () => ({ create: mockCreate }),
}));

describe("useCreateInsight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create insight from table", async () => {
    const { result } = renderHook(() => useCreateInsight());

    let insightId: string | null = null;
    await act(async () => {
      insightId = await result.current.createInsightFromTable("table-1");
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseTableId: "table-1",
    }));
    expect(insightId).toBeTruthy();
  });
});
```

#### Hook Testing Best Practices

- **Always use `act()`**: Wrap state updates and async operations
- **Use `waitFor()`**: For async assertions that may take time
- **Clear mocks**: Use `vi.clearAllMocks()` in `beforeEach`
- **Test stability**: Verify `useCallback` memoization with reference equality
- **Mock external dependencies**: Mock `@dashframe/core`, `next/navigation`, etc.

### E2E Testing Patterns

DashFrame uses **Playwright** with **playwright-bdd** for behavior-driven E2E tests.

#### Feature Files (Gherkin)

Located in `e2e/web/features/workflows/*.feature`:

```gherkin
Feature: Core Workflow: CSV to Chart
  As a new user
  I want to upload a CSV and create a chart immediately
  So that I can see value in the product quickly

  @core @workflow
  Scenario: Upload CSV and create a suggested chart
    Given I am on the DashFrame home page
    When I upload the "sales_data.csv" file
    Then I should be redirected to the insight configuration page
    And I should see chart suggestions
    When I click "Create" on the first suggestion
    Then I should be redirected to the visualization page
    And I should see the chart rendered
```

#### Step Definitions

Located in `e2e/web/steps/*.steps.ts`:

```typescript
import { Given, When, Then } from "@playwright/test/steps";
import { expect } from "@playwright/test";

Given("I am on the DashFrame home page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
});

When("I upload the {string} file", async ({ page }, filename: string) => {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(`./fixtures/${filename}`);
});
```

#### E2E Best Practices

- **Use semantic selectors**: Prefer `getByRole`, `getByLabel`, `getByText` over CSS selectors
- **Wait for navigation**: Use `page.waitForURL()` for route transitions
- **Reuse steps**: Import common steps from `common.steps.ts`
- **Tag scenarios**: Use `@workflow`, `@core`, `@visualization` for filtering
- **Add fixtures**: Place test data files in `e2e/web/fixtures/`

### Snapshot Testing

Use snapshot tests to catch regressions in chart configurations:

```typescript
import { describe, expect, it } from "vitest";
import { suggestByChartType } from "./suggest-charts";

describe("bar chart suggestions", () => {
  it("should generate categorical X + numerical Y encoding", () => {
    const suggestions = suggestByChartType("barY", analysis, insight);

    // Snapshot captures: chart type, encoding (x, y, color), labels
    expect(suggestions[0]).toMatchSnapshot();
  });
});
```

**When to use snapshots**:

- Chart configuration generation (encoding, transforms, labels)
- Complex object outputs where structure matters
- Visual regression detection for data transformations

**Run tests to generate snapshots**:

```bash
bun test chart-suggestions.snapshot.test.ts
```

Snapshots are saved in `__snapshots__/` directories. Review changes carefully in PRs.

### Coverage Requirements

**Coverage targets**: 80% for branches, functions, lines, and statements.

Configured in `vitest.config.ts`:

```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  thresholds: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
}
```

**Priority for testing**:

1. **HIGH**: Data operations (converters, analyzers, DataFrame logic)
2. **HIGH**: Business logic (chart suggestions, encoding validation, metric computation)
3. **MEDIUM**: React hooks (data fetching, state management)
4. **MEDIUM**: Utilities (helpers, type guards, formatting)
5. **LOW**: UI components (prefer E2E tests for user flows)

### Mock Strategies

#### Mocking Vitest Functions

```typescript
import { vi } from "vitest";

// Mock entire module
vi.mock("@dashframe/core", () => ({
  useDataSources: vi.fn(),
  getDataFrame: vi.fn(),
}));

// Mock with implementation
const mockFetch = vi.fn().mockResolvedValue({ data: [] });

// Mock console methods (suppress expected errors)
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

#### Mocking External Dependencies

Common mocks for DashFrame:

```typescript
// Mock @dashframe/core
vi.mock("@dashframe/core", () => ({
  useDataSources: () => [],
  getDataFrame: vi.fn(),
  useInsightMutations: () => ({ create: vi.fn() }),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

// Mock DuckDB provider
vi.mock("@/components/providers/DuckDBProvider", () => ({
  useDuckDB: () => ({
    connection: mockConnection,
    isInitialized: true,
  }),
}));
```

### Test File Organization

```
packages/types/src/
  encoding-helpers.ts
  encoding-helpers.test.ts       # Colocated with source

apps/web/lib/
  visualizations/
    suggest-charts.ts
    suggest-charts.test.ts        # Unit tests
    chart-suggestions.snapshot.test.ts  # Snapshot tests

apps/web/hooks/
  useCreateInsight.tsx
  useCreateInsight.test.tsx       # Hook tests with .tsx extension

e2e/web/
  features/
    workflows/
      csv_to_chart.feature        # Gherkin scenarios
  steps/
    common.steps.ts               # Reusable step definitions
    data-sources.steps.ts
  fixtures/
    sales_data.csv                # Test data files
```

### Running Tests in CI

Tests run automatically in GitHub Actions on:

- Pull requests (all tests + coverage)
- Main branch commits (all tests + coverage)
- Coverage reports uploaded to coverage service

**Local pre-commit checks**:

```bash
bun check        # Lint + typecheck + format
bun test:coverage  # Run tests with coverage
```

### Debugging Tests

```bash
# Run single test file
bun test suggest-charts.test.ts

# Run tests matching pattern
bun test --grep "bar chart"

# Run with UI (vitest UI)
bun test --ui

# Debug with breakpoints
bun test --inspect-brk

# E2E debugging
cd e2e/web
bun test:debug    # Opens Playwright inspector
bun test:ui       # Opens Playwright UI mode
```

### Writing New Tests

When adding new functionality:

1. **Start with unit tests**: Test pure functions and utilities first
2. **Add integration tests**: Test hooks and state interactions
3. **Add E2E tests**: For user-facing workflows (if critical path)
4. **Add snapshots**: For complex data transformations
5. **Run coverage**: Ensure you meet 80% threshold
6. **Update this doc**: If you introduce new patterns

**Example checklist**:

- [ ] Unit tests for all public functions
- [ ] Edge cases covered (null, undefined, empty arrays)
- [ ] Error handling tested
- [ ] Mock factories created for reusable test data
- [ ] No console.log statements
- [ ] Coverage threshold met (80%)
- [ ] Tests pass in CI
