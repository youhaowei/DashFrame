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
pnpm --filter @dash-frame/web dev      # Run only web app
pnpm --filter @dash-frame/notion build # Build only notion package
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
  ui/             # Placeholder for shared components
  eslint-config/  # Shared ESLint 9 flat config
```

**Critical**: Packages export TypeScript source directly (`main: "src/index.ts"`), not compiled JS. Web app uses TypeScript path mappings for hot reload. See `tsconfig.json` files.

## State Management & Persistence

**Zustand + Immer** with automatic localStorage persistence. See `docs/architecture.md` for details.

**localStorage keys**: All use `dash-frame:` prefix (kebab-case):

- `dash-frame:data-sources` - DataSources with nested Insights
- `dash-frame:dataframes` - EnhancedDataFrames with metadata
- `dash-frame:visualizations` - Vega-Lite specs + active tracking

## Critical Gotchas

### Vega-Lite SSR

**Must** dynamically import VegaChart with `ssr: false` - Vega-Lite uses Set objects that can't be serialized during Next.js SSR.

```typescript
const VegaChart = dynamic(() => import("./VegaChart"), { ssr: false });
```

### Naming Conventions

- **User-facing**: `DashFrame` (PascalCase)
- **Packages**: `@dash-frame/*` (kebab-case)
- **Storage keys**: `dash-frame:*` (kebab-case)

### Tailwind CSS v4

Uses PostCSS-only config via `@source` directives in `globals.css`. **Don't** create `tailwind.config.js`.

### Other Gotchas

- **No UI Package Content**: `@dash-frame/ui` is placeholder only
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

1. Check `docs/architecture.md` for vision and architecture alignment
2. Follow functional converter pattern (no classes/inheritance)
3. Use Zustand stores for state persistence (see `apps/web/lib/stores/`)
4. Add tRPC router if calling external APIs (avoid CORS)
5. Update `README.md` only for major user-facing features

### Architecture Principles

- **DataFrame is the contract**: All sources convert to it, all visualizations consume it
- **Functional > OOP**: Converter functions, not classes with methods
- **Zustand + Immer**: State management with automatic persistence
- **Type safety everywhere**: Leverage TypeScript strict mode
