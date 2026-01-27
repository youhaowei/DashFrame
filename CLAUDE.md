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

### Encryption for Sensitive Data

**Client-side encryption** protects sensitive fields (API keys, connection strings) in IndexedDB. Uses Web Crypto API with:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 with SHA-256, 100,000 iterations
- **Key storage**: CryptoKey cached in memory only (cleared on page reload)
- **Salt storage**: IndexedDB settings table (persistent, per-browser instance)

**Key management functions** (from `@dashframe/core`):

```typescript
import {
  initializeEncryption,
  isEncryptionInitialized,
  unlockEncryption,
  isEncryptionUnlocked,
  lockEncryption,
  migrateToEncryption,
} from "@dashframe/core";

// First-time setup
await initializeEncryption("user-passphrase");

// Subsequent sessions
if (await isEncryptionInitialized()) {
  await unlockEncryption("user-passphrase");
}

// Check if key is available
if (isEncryptionUnlocked()) {
  // Can access encrypted data
}

// Lock encryption (clears key from memory)
lockEncryption();
```

**Important**:

- User must unlock encryption each session (passphrase not stored)
- Encryption key required before accessing/modifying DataSources with API keys
- Protected routes (e.g., `/data-sources`) trigger unlock modal automatically
- Migration utility (`migrateToEncryption`) encrypts existing plaintext data on first setup

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

- **Notion API Keys**: Encrypted at rest in IndexedDB. User must unlock encryption with passphrase each session.
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
