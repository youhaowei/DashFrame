# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: DO NOT Run Build or Dev Commands

**⚠️ NEVER run `pnpm build` or `pnpm dev` unless explicitly requested by the user.**

The user manages their own development environment. Only run these commands if the user specifically asks you to.

## Essential Commands

### Workspace Commands (via Turborepo)

```bash
pnpm dev        # Run Next.js dev + TypeScript watch mode for all packages
pnpm build      # Build all packages and apps (dependencies first)
pnpm check      # Run lint + typecheck + format check
pnpm typecheck  # TypeScript checks across workspace
pnpm lint       # ESLint 9 (flat config)
pnpm format     # Prettier check
pnpm format:write  # Prettier write
```

### Targeting Specific Packages

```bash
pnpm --filter @dashframe/web dev      # Run only web app
pnpm --filter @dashframe/notion build # Build only notion package
turbo build --force                     # Force rebuild ignoring cache
```

## Core Architecture

**See `docs/architecture.md` for complete architecture details.**

### Key Concepts

- **DataFrame as central abstraction**: `CSV/Notion → DataFrame → Vega-Lite → Chart`
- **Functional converter pattern**: Pure functions, no classes/inheritance
- **Zustand + Immer**: State management with automatic localStorage persistence
- **Entity hierarchy**: DataSource → Insight → DataFrame → Visualization
- **tRPC for APIs**: Server-side proxy to avoid CORS issues

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
apps/web/         # Next.js 16 (App Router)
packages/
  dataframe/      # Core types
  csv/            # csvToDataFrame converter
  notion/         # notionToDataFrame + tRPC integration
  ui/             # Shared UI components (shadcn/ui primitives + custom components)
                  # Includes Storybook for component development
  eslint-config/  # Shared ESLint 9 flat config
```

**Critical**: Packages export TypeScript source directly (`main: "src/index.ts"`), not compiled JS. Web app uses TypeScript path mappings for hot reload. See `tsconfig.json` files.

## State Management & Persistence

**Zustand + Immer** with automatic localStorage persistence. See `docs/architecture.md` for details.

**localStorage keys**: All use the lowercase `dashframe:` prefix:

- `dashframe:data-sources` - DataSources with nested Insights
- `dashframe:dataframes` - EnhancedDataFrames with metadata
- `dashframe:visualizations` - Vega-Lite specs + active tracking

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
- **No Tests Yet**: Test scripts exist but no actual test files
- **Turborepo Cache**: Run `turbo build --force` if seeing stale builds

## Development Best Practices

### When Modifying Packages

1. Make changes in `packages/*/src/`
2. TypeScript watch mode auto-compiles (if `pnpm dev` running)
3. Next.js hot reload picks up changes immediately
4. No manual rebuild needed

### Before Committing

Run the check meta-command:

```bash
pnpm check  # Runs lint + typecheck + format
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

### UI Component Guidelines

**See `docs/ui-components.md` for comprehensive component documentation.**

Before implementing any UI changes, follow this component-first approach:

1. **Check existing components first**:
   - `@dashframe/ui` package exports all UI components (import from `@dashframe/ui`)
   - shadcn/ui primitives (23 components) - Button, Card, Input, Select, Dialog, etc.
   - Custom shared components (11 components) - ActionGroup, ItemSelector, Panel, Toggle, etc.
   - Icons from react-icons (Lucide, Feather, Simple Icons)
   - See `docs/ui-components.md` for full inventory and `pnpm storybook` to browse components
   - **IMPORTANT**: All UI elements on pages MUST use components from `@dashframe/ui`. If a needed component doesn't exist, add it to the UI package first before using it in pages.

2. **Component decision principles**:
   - **Use shadcn/ui components** for standard UI patterns (buttons, cards, dialogs, forms, etc.)
   - **Use shared components** for DashFrame-specific patterns (ActionGroup, ItemSelector, Toggle, etc.)
   - **Create feature-specific components** for one-off, domain-specific UI
   - **Extract to shared/** when patterns emerge across multiple features

3. **Design token enforcement** (from `docs/architecture.md`):
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

- Run `pnpm storybook` to launch Storybook at http://localhost:6006
- Browse all UI components with interactive examples
- Located in `packages/ui/` with stories in `src/**/*.stories.tsx`
- Configured with Storybook v10 using Next.js framework and Tailwind CSS v4

### Architecture Principles

- **DataFrame is the contract**: All sources convert to it, all visualizations consume it
- **Functional > OOP**: Converter functions, not classes with methods
- **Zustand + Immer**: State management with automatic persistence
- **Type safety everywhere**: Leverage TypeScript strict mode
