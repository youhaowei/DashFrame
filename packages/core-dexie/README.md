# @dashframe/core-dexie

Dexie (IndexedDB) persistence implementation for DashFrame. This package provides reactive hooks and mutation functions for CRUD operations on DashFrame entities.

## Installation

```bash
pnpm add @dashframe/core-dexie
```

## Overview

This package implements the repository interfaces defined in `@dashframe/core` using Dexie (IndexedDB):

| Entity         | Query Hook          | Mutation Hook               |
| -------------- | ------------------- | --------------------------- |
| DataSources    | `useDataSources`    | `useDataSourceMutations`    |
| DataTables     | `useDataTables`     | `useDataTableMutations`     |
| Insights       | `useInsights`       | `useInsightMutations`       |
| Visualizations | `useVisualizations` | `useVisualizationMutations` |
| Dashboards     | `useDashboards`     | `useDashboardMutations`     |

**Key Features:**

- Reactive data with `useLiveQuery` (auto-updates when IndexedDB changes)
- Stable mutation functions (safe to use in effects/callbacks)
- Automatic migration from localStorage (Zustand) to IndexedDB
- Re-exports all types from `@dashframe/core`

## Usage

```typescript
import {
  // Repository hooks
  useDataSources,
  useDataSourceMutations,
  useDataTables,
  useInsights,
  useVisualizations,

  // Types (re-exported from @dashframe/core)
  type DataSource,
  type DataTable,
  type Insight,
  type Visualization,
} from "@dashframe/core-dexie";

function DataSourcesList() {
  const { data: sources, isLoading } = useDataSources();
  const { addLocal, remove } = useDataSourceMutations();

  if (isLoading) return <Loading />;

  return (
    <ul>
      {sources?.map(source => (
        <li key={source.id}>{source.name}</li>
      ))}
    </ul>
  );
}
```

## App Setup

Wrap your app with `DatabaseProvider` to enable Dexie hooks and automatic migration:

```tsx
import { DatabaseProvider } from "@dashframe/core-dexie";

export default function RootLayout({ children }) {
  return <DatabaseProvider>{children}</DatabaseProvider>;
}
```

## Repository Hooks

### DataSources

```typescript
// Query hook - reactive data
const { data, isLoading } = useDataSources();

// Mutations
const { addLocal, setNotion, remove, clearNotion } = useDataSourceMutations();

// Direct access (non-React contexts)
const source = await getDataSource(id);
const local = await getLocalDataSource();
const notion = await getNotionDataSource();
const all = await getAllDataSources();
```

### DataTables

```typescript
const { data, isLoading } = useDataTables(dataSourceId);
const { add, update, remove } = useDataTableMutations();

// Direct access
const table = await getDataTable(id);
const tables = await getDataTablesBySource(dataSourceId);
```

### Insights

```typescript
const { data, isLoading } = useInsights();
const { add, update, remove } = useInsightMutations();

// Direct access
const insight = await getInsight(id);
```

### Visualizations

```typescript
const { data, isLoading } = useVisualizations(insightId);
const { add, update, remove, setActive } = useVisualizationMutations();

// Direct access
const viz = await getVisualization(id);
const vizs = await getVisualizationsByInsight(insightId);
const active = await getActiveVisualization();
```

### Dashboards

```typescript
const { data, isLoading } = useDashboards();
const { add, update, remove } = useDashboardMutations();

// Direct access
const dashboard = await getDashboard(id);
```

## Database Schema

Flat tables with foreign key relationships:

```typescript
// DataSource (local or Notion connection)
interface DataSourceEntity {
  id: UUID;
  type: "local" | "notion";
  name: string;
  apiKey?: string; // Notion only
  createdAt: number;
}

// DataTable (tables within a data source)
interface DataTableEntity {
  id: UUID;
  dataSourceId: UUID; // FK to DataSource
  name: string;
  table: string;
  sourceSchema?: SourceSchema;
  fields: Field[];
  metrics: Metric[];
  dataFrameId?: UUID;
  createdAt: number;
  lastFetchedAt?: number;
}

// Insight (query configuration)
interface InsightEntity {
  id: UUID;
  name: string;
  baseTableId: UUID; // FK to DataTable
  selectedFields: UUID[];
  metrics: InsightMetric[];
  filters?: FilterPredicate[];
  sorts?: SortOrder[];
  joins?: JoinConfig[];
  status: "pending" | "computing" | "ready" | "error";
  dataFrameId?: UUID;
  createdAt: number;
}

// Visualization (chart spec)
interface VisualizationEntity {
  id: UUID;
  name: string;
  insightId: UUID; // FK to Insight
  spec: VegaLiteSpec;
  isActive?: boolean;
  createdAt: number;
}

// Dashboard (layout of visualizations)
interface DashboardEntity {
  id: UUID;
  name: string;
  description?: string;
  panels: DashboardPanel[];
  createdAt: number;
}
```

## Migration from localStorage

Automatic migration from the old Zustand + superjson localStorage persistence:

```typescript
import {
  migrateFromLocalStorage,
  isMigrationComplete,
  resetMigration,
} from "@dashframe/core-dexie";

// Check migration status
if (!isMigrationComplete()) {
  await migrateFromLocalStorage();
}

// Reset migration (development only)
await resetMigration();
```

The migration:

1. Parses superjson-serialized data from localStorage
2. Flattens nested structures (dataTables from DataSource)
3. Converts to Dexie entities
4. Runs in a transaction for atomicity
5. Marks completion to prevent re-running

## Direct Database Access

For advanced use cases:

```typescript
import { db } from "@dashframe/core-dexie";

// Query directly
const sources = await db.dataSources.toArray();
const tables = await db.dataTables.where("dataSourceId").equals(id).toArray();

// Transactions
await db.transaction("rw", [db.dataSources, db.dataTables], async () => {
  await db.dataSources.add(source);
  await db.dataTables.bulkAdd(tables);
});
```

## Exports

```typescript
// Re-export all from @dashframe/core
export * from "@dashframe/core";

// Provider
export { DatabaseProvider, useDatabase } from "./provider";

// Repository hooks
export {
  useDataSources,
  useDataSourceMutations,
  useDataTables,
  useDataTableMutations,
  useInsights,
  useInsightMutations,
  useVisualizations,
  useVisualizationMutations,
  useDashboards,
  useDashboardMutations,
} from "./repositories";

// Direct access functions
export {
  getDataSource,
  getLocalDataSource,
  getNotionDataSource,
  getAllDataSources,
  getDataTable,
  getDataTablesBySource,
  getAllDataTables,
  getInsight,
  getAllInsights,
  getVisualization,
  getVisualizationsByInsight,
  getActiveVisualization,
  getDashboard,
  getAllDashboards,
} from "./repositories";

// Migration
export {
  migrateFromLocalStorage,
  isMigrationComplete,
  resetMigration,
} from "./migration";

// Database (advanced use)
export { db } from "./db";
export type {
  DataSourceEntity,
  DataTableEntity,
  InsightEntity,
  VisualizationEntity,
  DashboardEntity,
} from "./db";
```

## See Also

- `@dashframe/core` - Type definitions this package implements
- `docs/state-management.md` - State management patterns
- `docs/architecture.md` - High-level architecture overview
