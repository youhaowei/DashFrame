# Core Package Extraction + Dexie Migration

> **Status**: In Progress (Phases 1-3 Complete)
> **Created**: 2025-12-12
> **Tracking Issue**: TBD

## Overview

Comprehensive refactor to:

1. Extract shared abstractions to `@dashframe/core`
2. Split engine into interfaces + browser implementation
3. Implement persistence with Dexie (replacing Zustand localStorage)
4. Enable future Convex swap for commercial version

## Package Architecture (After Refactor)

```
packages/
  core/                    # @dashframe/core - Shared abstractions
  core-dexie/              # @dashframe/core-dexie - Dexie persistence
  engine/                  # @dashframe/engine - Abstract interfaces (RUNTIME AGNOSTIC)
  engine-browser/          # @dashframe/engine-browser - Browser implementation
  connector-csv/           # @dashframe/connector-csv (renamed from csv)
  connector-notion/        # @dashframe/connector-notion (renamed from notion)

  (future) core-convex/    # Commercial Convex implementation
  (future) engine-server/  # Server: DuckDB native, PostgreSQL
  (future) engine-mobile/  # Mobile: SQLite

apps/
  web/                     # Depends on: @dashframe/core-dexie, @dashframe/engine-browser
```

## Checklist

### Phase 1: Create New Packages ✅

- [x] **@dashframe/core** - Shared abstractions
  - [x] Create `packages/core/package.json` and tsconfig.json
  - [x] Move types from dataframe: UUID, Field, Metric, SourceSchema, ColumnType, TableColumn
  - [x] Define repository interfaces (UseDataSources, UseInsights, etc.)
  - [x] Export barrel file

- [x] **@dashframe/engine** - Abstract interfaces (ZERO runtime deps)
  - [x] Create `packages/engine/package.json` and tsconfig.json
  - [x] Define QueryEngine interface
  - [x] Define DataFrameStorage interface
  - [x] Define DataFrame interface
  - [x] Move connector base classes (BaseConnector, FileSourceConnector, RemoteApiConnector)
  - [x] Define computation types (QueryResult, AggregationOp)

- [x] **@dashframe/engine-browser** - Browser implementation
  - [x] Create `packages/engine-browser/package.json` with duckdb-wasm, apache-arrow, idb deps
  - [x] Move DuckDB-WASM integration from dataframe
  - [x] Implement IndexedDBStorage
  - [x] Implement BrowserDataFrame class
  - [x] Move QueryBuilder and Insight classes

- [x] **@dashframe/core-dexie** - Dexie persistence
  - [x] Create `packages/core-dexie/package.json` with dexie, dexie-react-hooks deps
  - [x] Define Dexie database schema (flat tables)
  - [x] Implement repository hooks (useDataSources, useInsights, etc.)
  - [x] Create migration from localStorage → Dexie
  - [x] Create DatabaseProvider component

### Phase 2: Rename Existing Packages ✅

- [x] **@dashframe/csv → @dashframe/connector-csv**
  - [x] Rename `packages/csv/` → `packages/connector-csv/`
  - [x] Update package.json name
  - [x] Update imports: dataframe → core (types) + engine-browser (DataFrame)

- [x] **@dashframe/notion → @dashframe/connector-notion**
  - [x] Rename `packages/notion/` → `packages/connector-notion/`
  - [x] Update package.json name
  - [x] Update imports: dataframe → core (types) + engine-browser (DataFrame)

### Phase 3: Delete Old Package ✅

- [x] **@dashframe/dataframe** → DELETE
  - [x] Verify all code moved to core, engine, or engine-browser
  - [x] Delete `packages/dataframe/` directory
  - [x] Remove from workspace packages

### Phase 4: Update Web App (Partial)

- [x] Update imports throughout apps/web:
  - [x] `@dashframe/dataframe` → `@dashframe/engine-browser`
  - [x] `@dashframe/csv` → `@dashframe/connector-csv`
  - [x] `@dashframe/notion` → `@dashframe/connector-notion`
- [ ] Replace Zustand stores with core-dexie hooks:
  - [ ] useDataSourcesStore → useDataSources + useDataSourceMutations
  - [ ] useInsightsStore → useInsights + useInsightMutations
  - [ ] useVisualizationsStore → useVisualizations + useVisualizationMutations
  - [ ] useDashboardsStore → useDashboards + useDashboardMutations
  - [ ] useDataFramesStore → handled by engine-browser
- [ ] Add DatabaseProvider to app layout
- [ ] Update components for async loading states

### Phase 5: Cleanup

- [ ] Delete `apps/web/lib/stores/` directory
- [ ] Delete `apps/web/lib/stores/storage.ts` (superjson)
- [ ] Delete StoreHydration provider (replaced by DatabaseProvider)
- [ ] Update pnpm-workspace.yaml if needed
- [ ] Update turbo.json if needed

### Phase 6: Testing & Docs

- [ ] Test: Fresh install - data persists after refresh
- [ ] Test: Migration - localStorage data loads into Dexie
- [ ] Test: All CRUD operations work
- [ ] Test: No infinite render loops
- [ ] Test: Loading states show correctly
- [ ] Test: connector-csv works
- [ ] Test: connector-notion works
- [ ] Test: Engine interfaces work
- [ ] Update docs/architecture.md
- [ ] Update README if needed

## Key Interfaces

### QueryEngine (packages/engine/src/interfaces/)

```typescript
export interface QueryEngine {
  query(sql: string): Promise<QueryResult>;
  registerTable(name: string, data: DataFrame): Promise<void>;
  unregisterTable(name: string): Promise<void>;
  isReady(): boolean;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}
```

### DataFrameStorage (packages/engine/src/interfaces/)

```typescript
export interface DataFrameStorage {
  save(id: UUID, data: Uint8Array): Promise<void>;
  load(id: UUID): Promise<Uint8Array | null>;
  delete(id: UUID): Promise<void>;
  exists(id: UUID): Promise<boolean>;
}
```

### Repository Hooks (packages/core/src/repositories/)

```typescript
export interface UseQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
}

export type UseDataSources = () => UseQueryResult<DataSource[]>;
export type UseDataSourceMutations = () => {
  addLocal: (name: string) => Promise<UUID>;
  setNotion: (name: string, apiKey: string) => Promise<UUID>;
  remove: (id: UUID) => Promise<void>;
};
```

## Migration Strategy

```typescript
// Run once on app mount via DatabaseProvider
async function migrateFromLocalStorage() {
  if (localStorage.getItem("dashframe:migrated-to-dexie")) return;

  // 1. Read existing localStorage data (superjson format)
  // 2. Flatten nested Maps → flat Dexie tables
  // 3. Insert into Dexie
  // 4. Mark migration complete

  localStorage.setItem("dashframe:migrated-to-dexie", "true");
}
```

## Design Decisions

1. **Engine split** - Abstract interfaces in `engine`, browser impl in `engine-browser`
2. **Multi-runtime ready** - Future `engine-server`, `engine-mobile` packages
3. **Flat tables** - DataTables separate from DataSources (not nested Maps)
4. **Async mutations** - All mutations return Promises
5. **useLiveQuery pattern** - Dexie's reactive queries for reads
6. **Re-export pattern** - core-dexie re-exports core types for single import
7. **Convex-ready** - Repository interfaces match Convex useQuery/useMutation pattern
