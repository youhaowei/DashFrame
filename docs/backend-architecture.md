# Backend Architecture

DashFrame uses a **plugin-based backend architecture** that allows switching data persistence layers via environment variables. This enables multiple deployment scenarios (OSS, cloud, self-hosted) from a single codebase.

## Overview

```
@dashframe/types         → Type contracts (interfaces)
@dashframe/core-dexie    → Dexie/IndexedDB implementation (OSS)
@dashframe/core-convex   → Convex implementation (future cloud)
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

**Published**: Public (open source)

### @dashframe/core-dexie (OSS Backend)

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

**Published**: Public (open source)

### @dashframe/core-convex (Future Cloud Backend)

Implements types using Convex for real-time cloud sync.

```typescript
// packages/core-convex/src/index.ts
import type { UseDataSources } from "@dashframe/types";
import { useQuery } from "convex/react";

export function useDataSources(): UseQueryResult<DataSource[]> {
  const data = useQuery(api.dataSources.list);
  return { data, isLoading: data === undefined };
}
```

**Dependencies**: `@dashframe/types`, `convex`

**Published**: Private (proprietary)

### @dashframe/core (Backend Selector)

Thin wrapper that selects backend implementation based on environment variable.

```typescript
// packages/core/src/index.ts
export * from "@dashframe/types";

const BACKEND = process.env.NEXT_PUBLIC_DATA_BACKEND || "dexie";

if (BACKEND === "convex") {
  export * from "@dashframe/core-convex";
} else {
  export * from "@dashframe/core-dexie";
}
```

**Dependencies**: `@dashframe/types`, `@dashframe/core-dexie`, `@dashframe/core-convex` (optional)

**Published**: Public (coordinates backends)

## Usage

### Environment Configuration

Set the backend via environment variable:

```bash
# .env.local (OSS deployment)
NEXT_PUBLIC_DATA_BACKEND=dexie

# .env.production (Cloud deployment)
NEXT_PUBLIC_DATA_BACKEND=convex
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

To switch from Dexie to Convex:

1. Update environment variable:

   ```bash
   NEXT_PUBLIC_DATA_BACKEND=convex
   ```

2. Rebuild the application:
   ```bash
   pnpm build
   ```

That's it! No code changes required.

## Creating a Custom Backend

Anyone can create a backend package by implementing the type contracts:

### Step 1: Create Package

```bash
mkdir packages/core-mybackend
cd packages/core-mybackend
pnpm init
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

### Step 3: Add to Core Selector

```typescript
// packages/core/src/index.ts
if (BACKEND === "mybackend") {
  export * from "@dashframe/core-mybackend";
} else if (BACKEND === "convex") {
  export * from "@dashframe/core-convex";
} else {
  export * from "@dashframe/core-dexie";
}
```

### Step 4: Use It

```bash
NEXT_PUBLIC_DATA_BACKEND=mybackend pnpm dev
```

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
NEXT_PUBLIC_DATA_BACKEND=dexie
```

- Data stored in browser IndexedDB
- No server required
- Fully offline-capable
- Free, open source

### Cloud Deployment (Real-Time Sync)

```bash
# .env.production
NEXT_PUBLIC_DATA_BACKEND=convex
NEXT_PUBLIC_CONVEX_URL=https://your-app.convex.cloud
```

- Data synced to Convex cloud
- Real-time updates across devices
- Multi-user collaboration
- Proprietary (paid)

### Self-Hosted Deployment (PostgreSQL)

```bash
# .env.production
NEXT_PUBLIC_DATA_BACKEND=postgres
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
NEXT_PUBLIC_DATA_BACKEND=mock pnpm test
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

**Q: How do I debug which backend is active?**

```typescript
import { getBackendInfo } from "@dashframe/core";
console.log(getBackendInfo()); // { backend: "dexie", version: "1.0.0" }
```

**Q: Can third-party packages extend DashFrame with new backends?**

Yes! As long as they implement `@dashframe/types` interfaces, they can be plugged in via the env var.
