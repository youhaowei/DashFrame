# Backend Architecture

DashFrame uses a **plugin-based backend architecture** that allows switching data persistence layers via environment variables. This enables flexible deployment options from a single codebase.

## Overview

```
@dashframe/types         → Type contracts (interfaces)
@dashframe/core-dexie    → Dexie/IndexedDB implementation (default)
@dashframe/core-store    → Stub package (re-exports default backend)
@dashframe/core          → Thin selector (picks backend via env)
```

## Architecture Principles

1. **Types define the contract** - `@dashframe/types` contains all repository interfaces
2. **Backends implement contracts** - Each backend package implements the type interfaces
3. **Core selects backend** - `@dashframe/core` uses env vars to choose implementation
4. **App is backend-agnostic** - Components import from `@dashframe/core` only

## Package Structure

### @dashframe/types (Pure Contracts)

Contains only TypeScript type definitions - zero runtime dependencies.

```typescript
// packages/types/src/data-sources.ts
export interface DataSource {
  id: UUID;
  name: string;
  type: string;
  // ...
}

export type UseDataSources = () => UseQueryResult<DataSource[]>;
export type UseDataSourceMutations = () => DataSourceMutations;
```

### @dashframe/core-dexie (Default Backend)

Implements types using Dexie (IndexedDB) for client-side persistence.

```typescript
// packages/core-dexie/src/index.ts
import type { UseDataSources } from "@dashframe/types";

export function useDataSources(): UseQueryResult<DataSource[]> {
  const data = useLiveQuery(() => db.dataSources.toArray());
  return { data, isLoading: data === undefined };
}
```

**Dependencies**: `@dashframe/types`, `dexie`, `dexie-react-hooks`

### @dashframe/core-store (Stub Package)

A stub package that re-exports from the default backend (`@dashframe/core-dexie`). This provides TypeScript type resolution while webpack aliases it to the selected backend at build time.

```typescript
// packages/core-store/src/index.ts
// Re-export all types and implementations from the default storage backend
// Webpack will replace this entire module at build time
export * from "@dashframe/core-dexie";
```

**Dependencies**: `@dashframe/types`, `@dashframe/core-dexie`

### @dashframe/core (Backend Selector)

Uses build-time webpack aliases to select backend implementation. Exports from the stub package `@dashframe/core-store` which is aliased to the chosen backend package.

```typescript
// packages/core/src/backend.ts
// Stub package aliased at build time to the chosen storage implementation
export * from "@dashframe/core-store";
```

**Build-time alias configuration** (in `apps/web/next.config.mjs`):

```javascript
const backend = process.env.NEXT_PUBLIC_STORAGE_IMPL || "dexie";
const backendPackage = `@dashframe/core-${backend}`;

config.resolve.alias = {
  ...config.resolve.alias,
  "@dashframe/core-store": backendPackage,
};
```

**Result**: Only the selected backend is bundled; unused backends are tree-shaken away. TypeScript resolves `@dashframe/core-store` as a normal workspace package (no path aliases needed).

**Dependencies**: `@dashframe/types` (no backend dependencies bundled)

## Usage

### Environment Configuration

Set the backend via environment variable:

```bash
# .env.local (default)
NEXT_PUBLIC_STORAGE_IMPL=dexie

# .env.production (custom backend)
NEXT_PUBLIC_STORAGE_IMPL=custom
```

### Application Code

Components import from `@dashframe/core` and remain backend-agnostic:

```typescript
import { useDataSources, useDataSourceMutations } from "@dashframe/core";
import type { DataSource } from "@dashframe/core";

export function DataSourcesList() {
  const { data, isLoading } = useDataSources();
  const { add, remove } = useDataSourceMutations();

  // Works with any backend!
}
```

## Switching Backends

The backend is selected at build time via webpack alias resolution. To switch:

1. Set the environment variable to match your backend package name:

   ```bash
   # For @dashframe/core-dexie (default)
   NEXT_PUBLIC_STORAGE_IMPL=dexie

   # For @dashframe/core-mybackend
   NEXT_PUBLIC_STORAGE_IMPL=mybackend
   ```

2. Rebuild the application:
   ```bash
   bun build
   ```

**How it works**:

- Webpack reads `NEXT_PUBLIC_STORAGE_IMPL` env var
- Aliases `@dashframe/core-store` → `@dashframe/core-${backend}`
- Only the selected backend package is bundled
- Unused backends are completely tree-shaken away

No code changes required - just env var + rebuild!

## Creating a Custom Backend

Anyone can create a backend package by implementing the type contracts:

### Step 1: Create Package

```bash
mkdir packages/core-mybackend
cd packages/core-mybackend
bun init
```

### Step 2: Implement Interfaces

```typescript
// packages/core-mybackend/src/index.ts
import type {
  UseDataSources,
  UseDataSourceMutations,
  DataSource,
} from "@dashframe/types";

export * from "@dashframe/types";

export function useDataSources(): UseQueryResult<DataSource[]> {
  // Your implementation here
}

export function useDataSourceMutations(): DataSourceMutations {
  return {
    add: async (input) => {
      /* ... */
    },
    update: async (id, updates) => {
      /* ... */
    },
    remove: async (id) => {
      /* ... */
    },
  };
}

// Implement all other hooks...
```

### Step 3: Use It

No code changes needed in `@dashframe/core` - the build-time alias automatically resolves to your package!

```bash
# Development
NEXT_PUBLIC_STORAGE_IMPL=mybackend bun dev

# Production build
NEXT_PUBLIC_STORAGE_IMPL=mybackend bun build
```

**How it works**:

1. Your package name must follow the pattern: `@dashframe/core-{name}`
2. Set `NEXT_PUBLIC_STORAGE_IMPL={name}` in environment
3. Webpack alias resolves `@dashframe/core-store` → `@dashframe/core-{name}`
4. Only your backend is bundled; core packages remain unchanged

## Backend Requirements

All backend implementations MUST:

1. **Implement all repository hooks** from `@dashframe/types`:
   - `useDataSources`, `useDataSourceMutations`
   - `useDataTables`, `useDataTableMutations`
   - `useInsights`, `useInsightMutations`
   - `useVisualizations`, `useVisualizationMutations`
   - `useDashboards`, `useDashboardMutations`

2. **Follow the UseQueryResult contract**:

   ```typescript
   interface UseQueryResult<T> {
     data: T | undefined; // undefined while loading
     isLoading: boolean;
   }
   ```

3. **Provide DatabaseProvider component** (if needed):

   ```typescript
   export function DatabaseProvider({ children }: { children: ReactNode }) {
     // Initialize backend (e.g., Dexie DB, Convex client)
     return <Provider>{children}</Provider>;
   }
   ```

4. **Export all types from `@dashframe/types`**:
   ```typescript
   export * from "@dashframe/types";
   ```

## Example Backends

### Built-in Backends

| Backend | Package                  | Storage    | Use Case           |
| ------- | ------------------------ | ---------- | ------------------ |
| Dexie   | `@dashframe/core-dexie`  | IndexedDB  | OSS, offline-first |
| Convex  | `@dashframe/core-convex` | Cloud sync | SaaS, real-time    |

### Community Backends (Examples)

| Backend    | Package                    | Storage    | Use Case           |
| ---------- | -------------------------- | ---------- | ------------------ |
| PostgreSQL | `@dashframe/core-postgres` | PostgreSQL | Self-hosted        |
| Supabase   | `@dashframe/core-supabase` | Supabase   | Managed PostgreSQL |
| Firebase   | `@dashframe/core-firebase` | Firestore  | Google Cloud       |

## Benefits

1. **OSS/Cloud Split**: Same codebase, different backends
2. **Plugin Ecosystem**: Community can create backends
3. **Easy Testing**: Swap in mock backend via env
4. **Type Safety**: TypeScript validates all backends
5. **Tree Shaking**: Unused backends removed from bundle

## Deployment Scenarios

### OSS Deployment (Client-Side Only)

```bash
# .env.production
NEXT_PUBLIC_STORAGE_IMPL=dexie
```

- Data stored in browser IndexedDB
- No server required
- Fully offline-capable
- Free, open source

### Cloud Deployment (Real-Time Sync)

```bash
# .env.production
NEXT_PUBLIC_STORAGE_IMPL=convex
NEXT_PUBLIC_CONVEX_URL=https://your-app.convex.cloud
```

- Data synced to Convex cloud
- Real-time updates across devices
- Multi-user collaboration
- Proprietary (paid)

### Self-Hosted Deployment (PostgreSQL)

```bash
# .env.production
NEXT_PUBLIC_STORAGE_IMPL=postgres
DATABASE_URL=postgresql://localhost:5432/dashframe
```

- Data in your own PostgreSQL
- Full control over infrastructure
- Enterprise use case
- Community or custom backend

## TypeScript Configuration

The conditional exports work because Next.js performs build-time evaluation of environment variables and tree-shakes unused code paths.

TypeScript sees all possible exports during development, providing full IntelliSense regardless of which backend is selected.

## Testing

Mock backend for tests:

```typescript
// packages/core-mock/src/index.ts
export function useDataSources(): UseQueryResult<DataSource[]> {
  return {
    data: [{ id: "1", name: "Test Source", type: "csv" }],
    isLoading: false,
  };
}
```

```bash
NEXT_PUBLIC_STORAGE_IMPL=mock bun test
```

## Migration Path

When switching backends in production:

1. Export data from old backend
2. Import data to new backend
3. Update environment variable
4. Redeploy application

Future: Add migration utilities to `@dashframe/core` for automated data transfer between backends.

## FAQ

**Q: Can I use multiple backends simultaneously?**

Not currently. The env var selects one backend per deployment. Future enhancement could support federated backends.

**Q: What if a backend doesn't support a feature?**

Backends can throw `NotImplementedError` for unsupported operations. The app should handle these gracefully.

**Q: Can third-party packages extend DashFrame with new backends?**

Yes! As long as they implement `@dashframe/types` interfaces, they can be plugged in via the env var.
