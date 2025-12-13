# @dashframe/engine-browser

Browser implementation of DashFrame engine using DuckDB-WASM. This package provides the runtime implementations for `@dashframe/engine` interfaces.

## Installation

```bash
pnpm add @dashframe/engine-browser
```

## Overview

This package implements the abstract engine interfaces for browser environments:

| Interface          | Implementation                               |
| ------------------ | -------------------------------------------- |
| `DataFrame`        | `BrowserDataFrame` (Arrow IPC serialization) |
| `DataFrameStorage` | `IndexedDBStorage` (idb-keyval)              |
| `QueryBuilder`     | SQL generation for DuckDB-WASM               |
| `Insight`          | Query configuration and SQL generation       |

**Why DuckDB-WASM:**

- 100x-1000x faster than JavaScript loops for aggregations
- Columnar storage (Arrow IPC) reduces memory usage
- SQL query interface for complex transforms
- Native integration with Mosaic vgplot for visualization
- Runs entirely client-side (no server needed)

## Usage

```typescript
import {
  BrowserDataFrame,
  IndexedDBStorage,
  QueryBuilder,
  Insight,
} from "@dashframe/engine-browser";

// Also re-exports all @dashframe/engine types
import type { UUID, Field, Metric } from "@dashframe/engine-browser";
```

## Architecture Flow

```
SOURCE DATA:
  CSV/Notion → Arrow IPC → IndexedDB → DataFrame reference
                                          ↓
                              DuckDB table (loaded on-demand)

QUERY & RENDER:
  Insight (config) → SQL Query → DuckDB executes → vgplot renders directly
                                (no intermediate storage)
```

## Data Storage Model

```
┌─────────────────────────────────────────────────────────────────┐
│  SOURCE DATA (Persisted)                                        │
│  ┌────────────────────┐          ┌────────────────────────────┐ │
│  │ localStorage       │ ──ref──▶ │ IndexedDB                  │ │
│  │ DataFrame metadata │          │ Arrow IPC (source tables)  │ │
│  └────────────────────┘          └────────────────────────────┘ │
│                                            │                    │
│                                            ▼ load on-demand     │
│                                  ┌────────────────────────────┐ │
│                                  │ DuckDB tables              │ │
│                                  │ (source data only)         │ │
│                                  └────────────────────────────┘ │
│                                            │                    │
│                                            ▼ query              │
│  QUERY RESULTS (Not stored)      ┌────────────────────────────┐ │
│  ───────────────────────────     │ Mosaic vgplot              │ │
│  SQL → DuckDB → vgplot direct    │ (renders query results)    │ │
│                                  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Storage Locations:**

- **localStorage**: Metadata (DataSources, Insights, Visualizations, DataFrame references)
- **IndexedDB**: Arrow IPC binary data (source tables only)
- **DuckDB-WASM**: Tables for source data (loaded from Arrow IPC on-demand)
- **Mosaic vgplot**: Renders directly from DuckDB query results (no intermediate storage)

## Core Components

### BrowserDataFrame

Lightweight reference to persisted data with explicit storage location. Does NOT contain actual data - knows WHERE to find it.

```typescript
class BrowserDataFrame implements DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameStorageLocation;
  readonly fieldIds: UUID[];
  readonly primaryKey?: string | string[];

  // Entry point to query operations
  async load(conn: AsyncDuckDBConnection): Promise<QueryBuilder>;

  // Serialization (only metadata stored in localStorage)
  toJSON(): DataFrameSerialization;
  static fromJSON(data: DataFrameSerialization): BrowserDataFrame;

  // Factory for creating new DataFrames
  static async create(
    arrowBuffer: Uint8Array,
    fieldIds: UUID[],
    options?: { storageType?: "indexeddb"; primaryKey?: string | string[] },
  ): Promise<BrowserDataFrame>;
}
```

**When DataFrame is Used:**

- **Persistence**: Save data across browser sessions (Arrow IPC in IndexedDB)
- **Sharing**: Reference data by ID across components
- **Cloud storage**: Future S3/R2 integration

**When DataFrame is NOT Needed:**

- **Previews**: Data goes directly to DuckDB temp table → vgplot
- **Exploratory queries**: Results stay in DuckDB, render immediately
- **Transient analysis**: No need to persist every intermediate result

### IndexedDBStorage

Implements `DataFrameStorage` interface using idb-keyval for Arrow IPC buffer storage:

```typescript
class IndexedDBStorage implements DataFrameStorage {
  save(id: UUID, data: Uint8Array): Promise<void>;
  load(id: UUID): Promise<Uint8Array | null>;
  delete(id: UUID): Promise<void>;
  exists(id: UUID): Promise<boolean>;
  list(): Promise<UUID[]>;
  getUsage(): Promise<{ count: number; totalBytes?: number }>;
}

// Singleton instance
export const indexedDBStorage: IndexedDBStorage;
```

### QueryBuilder

Builds SQL queries from chained operations with deferred execution:

```typescript
class QueryBuilder {
  constructor(dataFrame: DataFrame, conn: AsyncDuckDBConnection);

  // Operation chaining (deferred execution)
  filter(predicates: FilterPredicate[]): QueryBuilder;
  sort(orders: SortOrder[]): QueryBuilder;
  groupBy(columns: string[], aggregations?: Aggregation[]): QueryBuilder;
  join(other: DataFrame, options: JoinOptions): QueryBuilder;
  limit(count: number): QueryBuilder;
  offset(count: number): QueryBuilder;
  select(columns: string[]): QueryBuilder;

  // Execution
  sql(): Promise<string>; // Generate SQL
  run(): Promise<BrowserDataFrame>; // Execute and return new DataFrame
  preview(): Promise<Record<string, unknown>[]>; // First 10 rows
  count(): Promise<number>; // Row count
}
```

**Key Design:** QueryBuilder generates SQL, vgplot executes it directly. No intermediate result storage.

### Insight

Query configuration with embedded DataTable objects. Generates SQL for vgplot to execute directly:

```typescript
class Insight {
  constructor(config: InsightConfiguration);

  // Property accessors
  get id(): UUID;
  get name(): string;
  get baseTable(): DataTableInfo;
  get selectedFields(): UUID[];
  get metrics(): InsightMetric[];
  get filters(): FilterPredicate[];
  get groupBy(): string[];
  get orderBy(): SortOrder[];
  get limit(): number | undefined;
  get joins(): InsightConfiguration["joins"];

  // Generate SQL (vgplot executes directly)
  toSQL(): string;

  // Immutable updates
  with(updates: Partial<InsightConfiguration>): Insight;
  withSelectedFields(fieldIds: UUID[]): Insight;
  withMetrics(metrics: InsightMetric[]): Insight;
  withFilters(filters: FilterPredicate[]): Insight;
  withGroupBy(groupBy: string[]): Insight;
  withLimit(limit: number | undefined): Insight;

  // Serialization
  toJSON(): InsightConfiguration;
  static fromJSON(config: InsightConfiguration): Insight;
}
```

## Usage Examples

**Query and render (no intermediate storage):**

```typescript
const { connection } = useDuckDB();

// Load DataFrame and build query
const queryBuilder = await dataFrame.load(connection);
const query = queryBuilder
  .filter([{ columnName: "active", operator: "=", value: true }])
  .sort([{ columnName: "created_at", direction: "desc" }])
  .limit(100);

// vgplot renders directly from query
const sql = await query.sql();
vgplot.plot(connection, sql);
```

**Insight-based analysis:**

```typescript
const insight = new Insight({
  name: "Sales by Region",
  baseTable: salesTableInfo,
  metrics: [{ name: "total", columnName: "amount", aggregation: "sum" }],
  groupBy: ["region"],
  orderBy: [{ columnName: "total", direction: "desc" }],
});

// Generate SQL, vgplot renders directly
const sql = insight.toSQL();
vgplot.plot(connection, sql);
```

**CSV Upload (persists source data):**

```typescript
const { dataFrame, fields, sourceSchema } = await csvToDataFrame(csvData, conn);

// dataFrame is already persisted to IndexedDB via BrowserDataFrame.create()
// Load into DuckDB for queries
const queryBuilder = await dataFrame.load(conn);
```

## Table Loading

QueryBuilder handles loading data from IndexedDB into DuckDB with:

- **Mutex pattern**: Prevents race conditions when multiple components load the same table
- **Caching**: Tables loaded once per session, invalidated when data changes
- **On-demand loading**: Tables loaded only when queries are executed

```typescript
// Invalidate cache when data changes
import {
  invalidateTableCache,
  clearAllTableCaches,
} from "@dashframe/engine-browser";

invalidateTableCache(dataFrameId); // Single table
clearAllTableCaches(); // All tables
```

## Exports

```typescript
// DataFrame implementation
export { BrowserDataFrame, browserDataFrameFactory } from "./dataframe";

// Storage implementation
export { IndexedDBStorage, indexedDBStorage } from "./storage";

// Query building
export {
  QueryBuilder,
  invalidateTableCache,
  clearAllTableCaches,
} from "./query-builder";

// Insight
export { Insight, shortenAutoGeneratedName } from "./insight";

// Re-exports all from @dashframe/engine
export * from "@dashframe/engine";
```

## See Also

- `@dashframe/engine` - Abstract interfaces this package implements
- `@dashframe/core` - Core types (UUID, Field, Metric)
- `docs/architecture.md` - High-level architecture overview
- `docs/state-management.md` - State management patterns
