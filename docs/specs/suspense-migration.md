# Suspense Migration Plan

## Overview

Migrate DashFrame's data fetching layer from imperative `isLoading`/`isReady` patterns to React 19 Suspense. This enables declarative loading states, cleaner component code, and better multi-backend support (Dexie, Convex, future backends).

## Motivation

### Current State

- **Dexie hooks** use `useLiveQuery` returning `undefined` while loading
- **DuckDB hooks** use `useState`/`useEffect` with `isInitialized` flags
- **Components** handle loading with conditional rendering: `isReady ? <Content /> : <Loading />`
- **Multiple loading indicators** can appear simultaneously (inconsistent UX)

### Target State

- **Suspense boundaries** handle all loading states declaratively
- **Components** just render data - no loading conditionals
- **Consistent skeletons** via `<Suspense fallback={<Skeleton />}>`
- **Backend-agnostic** - same hooks work with Dexie, Convex, or future backends

## Design Principles

1. **Incremental Migration**: Migrate one layer at a time, maintaining backward compatibility
2. **Backend Contract**: Define Promise-based repository interfaces that any backend can implement
3. **TanStack Query as Adapter**: Use `useSuspenseQuery` to bridge async functions to Suspense
4. **Colocation**: Suspense boundaries live close to where data is used

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (React Components)                                │
│  └── <Suspense fallback={<Skeleton />}>                     │
│        └── <DataModelSection />                             │
├─────────────────────────────────────────────────────────────┤
│  Query Layer (TanStack Query)                               │
│  └── useSuspenseQuery({                                     │
│        queryKey: ['insights'],                              │
│        queryFn: insightRepository.getAll                    │
│      })                                                     │
├─────────────────────────────────────────────────────────────┤
│  Repository Contract (@dashframe/types)                     │
│  └── interface InsightRepository {                          │
│        getAll(): Promise<Insight[]>                         │
│        getById(id: UUID): Promise<Insight | null>           │
│      }                                                      │
├─────────────────────────────────────────────────────────────┤
│  Backend Implementations                                    │
│  ├── @dashframe/core-dexie  → IndexedDB                     │
│  ├── @dashframe/core-convex → Convex Cloud (future)         │
│  └── @dashframe/core-*      → Other backends                │
└─────────────────────────────────────────────────────────────┘
```

### Repository Contract

```typescript
// packages/types/src/repositories.ts

export interface InsightRepository {
  getAll(options?: { excludeIds?: UUID[] }): Promise<Insight[]>;
  getById(id: UUID): Promise<Insight | null>;
  create(
    name: string,
    baseTableId: UUID,
    options?: CreateInsightOptions,
  ): Promise<UUID>;
  update(id: UUID, updates: Partial<Insight>): Promise<void>;
  delete(id: UUID): Promise<void>;
}

export interface DataFrameRepository {
  getAll(): Promise<DataFrameEntry[]>;
  getById(id: UUID): Promise<DataFrameEntry | null>;
  create(entry: DataFrameEntry): Promise<void>;
  delete(id: UUID): Promise<void>;
}

// Similar for DataSource, DataTable, Visualization, Dashboard
```

## Migration Phases

### Phase 1: Repository Abstraction (Foundation)

**Goal**: Extract repository interfaces without changing behavior.

**Tasks**:

1. Define repository interfaces in `@dashframe/types`
2. Refactor `@dashframe/core-dexie` to export repository objects (not just hooks)
3. Keep existing hooks working (backward compatible)

**Files Changed**:

- `packages/types/src/repositories.ts` (new)
- `packages/core-dexie/src/repositories/*.ts` (refactor)

**Example**:

```typescript
// packages/core-dexie/src/repositories/insights.ts

// New: Repository object with Promise-based methods
export const insightRepository: InsightRepository = {
  getAll: async (options) => {
    let entities = await db.insights.toArray();
    if (options?.excludeIds?.length) {
      entities = entities.filter((e) => !options.excludeIds!.includes(e.id));
    }
    return entities.map(entityToInsight);
  },
  getById: async (id) => {
    const entity = await db.insights.get(id);
    return entity ? entityToInsight(entity) : null;
  },
  // ... other methods
};

// Existing: Hooks still work (use repository internally)
export function useInsights(options?: {
  excludeIds?: UUID[];
}): UseQueryResult<Insight[]> {
  const data = useLiveQuery(
    () => insightRepository.getAll(options),
    [options?.excludeIds?.join(",")],
  );
  return { data, isLoading: data === undefined };
}
```

### Phase 2: TanStack Query Integration

**Goal**: Add Suspense-compatible hooks alongside existing hooks.

**Tasks**:

1. Create `useSuspenseQuery` wrappers for each repository
2. Add QueryClient provider to app root
3. Configure staleTime/cacheTime for optimal UX

**Files Changed**:

- `packages/core/src/hooks/suspense/*.ts` (new)
- `apps/web/app/layout.tsx` (add QueryClientProvider)

**Example**:

```typescript
// packages/core/src/hooks/suspense/useInsightsSuspense.ts
import { useSuspenseQuery } from "@tanstack/react-query";
import { insightRepository } from "@dashframe/core-store";

export function useInsightsSuspense(options?: { excludeIds?: UUID[] }) {
  return useSuspenseQuery({
    queryKey: ["insights", options?.excludeIds],
    queryFn: () => insightRepository.getAll(options),
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useInsightSuspense(id: UUID) {
  return useSuspenseQuery({
    queryKey: ["insight", id],
    queryFn: () => insightRepository.getById(id),
  });
}
```

### Phase 3: DuckDB Suspense Resource

**Goal**: Make DuckDB initialization Suspense-compatible.

**Tasks**:

1. Create singleton Promise for DuckDB initialization
2. Use React 19's `use()` hook for Suspense integration
3. Wrap in Suspense boundary at provider level

**Files Changed**:

- `apps/web/lib/duckdb/resource.ts` (new)
- `apps/web/components/providers/DuckDBProvider.tsx` (refactor)

**Example**:

```typescript
// apps/web/lib/duckdb/resource.ts
import * as duckdb from "@duckdb/duckdb-wasm";

interface DuckDBInstance {
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
}

let instancePromise: Promise<DuckDBInstance> | null = null;

export function getDuckDBInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    instancePromise = initializeDuckDB();
  }
  return instancePromise;
}

async function initializeDuckDB(): Promise<DuckDBInstance> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const worker = createWorkerFromCDN(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new DuckDBLogger(), worker);
  await db.instantiate(bundle.mainModule);
  const connection = await db.connect();
  return { db, connection };
}

// apps/web/components/providers/DuckDBProvider.tsx
import { use, Suspense } from "react";
import { getDuckDBInstance } from "@/lib/duckdb/resource";

function DuckDBProviderInner({ children }: { children: React.ReactNode }) {
  const instance = use(getDuckDBInstance()); // Suspends until ready
  return (
    <DuckDBContext.Provider value={{ ...instance, isInitialized: true }}>
      {children}
    </DuckDBContext.Provider>
  );
}

export function DuckDBProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DuckDBLoadingFallback />}>
      <DuckDBProviderInner>{children}</DuckDBProviderInner>
    </Suspense>
  );
}
```

### Phase 4: Component Migration

**Goal**: Migrate components to use Suspense boundaries.

**Tasks**:

1. Add Suspense boundaries to page layouts
2. Replace `isLoading` conditionals with Suspense fallbacks
3. Create reusable skeleton components

**Migration Pattern**:

```typescript
// Before: Imperative loading
function DataModelSection({ insight }: Props) {
  const { isReady, fetchData, totalCount } = useInsightPagination({ insight });

  if (!isReady) {
    return <Skeleton height={360} />;
  }

  return (
    <Section title="Data model" description={`${totalCount} rows`}>
      <VirtualTable onFetchData={fetchData} />
    </Section>
  );
}

// After: Declarative Suspense
function InsightPage({ insightId }: Props) {
  return (
    <Suspense fallback={<DataModelSkeleton />}>
      <DataModelSection insightId={insightId} />
    </Suspense>
  );
}

function DataModelSection({ insightId }: Props) {
  // These hooks suspend - no loading check needed
  const { data: insight } = useInsightSuspense(insightId);
  const { totalCount, fetchData } = useInsightDataSuspense(insight);

  return (
    <Section title="Data model" description={`${totalCount} rows`}>
      <VirtualTable onFetchData={fetchData} />
    </Section>
  );
}
```

### Phase 5: Convex Backend (Future)

**Goal**: Add Convex as alternative backend using same repository contract.

**Tasks**:

1. Create `@dashframe/core-convex` package
2. Implement repository interfaces using Convex client
3. Leverage Convex's native Suspense support

**Example**:

```typescript
// packages/core-convex/src/repositories/insights.ts
import { ConvexHttpClient } from "convex/browser";
import { api } from "./convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const insightRepository: InsightRepository = {
  getAll: (options) =>
    convex.query(api.insights.list, { excludeIds: options?.excludeIds }),
  getById: (id) => convex.query(api.insights.get, { id }),
  create: (name, baseTableId, options) =>
    convex.mutation(api.insights.create, { name, baseTableId, ...options }),
  update: (id, updates) =>
    convex.mutation(api.insights.update, { id, ...updates }),
  delete: (id) => convex.mutation(api.insights.delete, { id }),
};
```

## Rollout Strategy

### Feature Flag Approach

Use environment variable to toggle Suspense hooks:

```typescript
// packages/core/src/index.ts
const USE_SUSPENSE = process.env.NEXT_PUBLIC_USE_SUSPENSE === "true";

export const useInsights = USE_SUSPENSE
  ? useInsightsSuspense
  : useInsightsLegacy;
```

### Gradual Migration

1. **Week 1-2**: Phase 1 (Repository abstraction)
2. **Week 3-4**: Phase 2 (TanStack Query integration)
3. **Week 5**: Phase 3 (DuckDB Suspense)
4. **Week 6-8**: Phase 4 (Component migration, page by page)
5. **Future**: Phase 5 (Convex backend when needed)

## Testing Strategy

### Unit Tests

- Repository methods return correct data shapes
- Suspense hooks throw promises correctly
- Error boundaries catch and display errors

### Integration Tests

- Suspense fallbacks render during loading
- Data appears after Suspense resolves
- Multiple Suspense boundaries work independently

### E2E Tests

- Page loads with skeleton, then content
- Navigation between pages shows appropriate loading states
- Error states display correctly

## Risks & Mitigations

| Risk                                                 | Impact | Mitigation                                         |
| ---------------------------------------------------- | ------ | -------------------------------------------------- |
| Dexie `useLiveQuery` not Suspense-compatible         | Medium | Wrap in TanStack Query for Suspense                |
| DuckDB init blocks entire app                        | High   | Isolate DuckDB Suspense boundary                   |
| Breaking existing functionality                      | High   | Feature flag, gradual rollout                      |
| TanStack Query cache conflicts with Dexie reactivity | Medium | Configure short staleTime, invalidate on mutations |

## Success Metrics

- [ ] No `isLoading` conditionals in migrated components
- [ ] Consistent skeleton loading across all pages
- [ ] New Convex backend works with zero UI changes
- [ ] Bundle size neutral (no significant increase)
- [ ] Lighthouse performance score maintained or improved

## References

- [React 19 Suspense docs](https://react.dev/reference/react/Suspense)
- [TanStack Query Suspense](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
- [Convex React Suspense](https://docs.convex.dev/client/react/suspense)
- [DashFrame Backend Architecture](../backend-architecture.md)
