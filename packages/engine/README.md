# @dashframe/engine

Abstract engine interfaces for DashFrame computation. This package defines contracts that can be implemented for different runtimes.

## Installation

```bash
bun add @dashframe/engine
```

## Overview

The engine package defines runtime-agnostic interfaces:

| Interface          | Real implementation today                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| `QueryEngine`      | `NativeDuckDBEngine` and `WorkspaceQueryEngine` (`@dashframe/engine-server`) |
| `DataFrameStorage` | Project files for server snapshots; retained IndexedDB implementation        |
| `DataFrame`        | Server query results; retained `BrowserDataFrame` implementation             |

Remote imports and refreshes use **server-side native DuckDB** (`NativeDuckDBEngine`) and durable project-file snapshots for both desktop and web. Local-file import still uses the legacy browser/IndexedDB path until the required server-ingestion follow-up lands. There is no selectable WASM mode or fallback.

This package has no shared `QueryPlanner` / push-down API. Connectors may still run remote queries themselves (e.g. Postgres table-reference fetches push LIMIT/OFFSET server-side); that is connector-local, not a cross-engine planner.

`QueryEngine` is Arrow-native and total: every backing implements every method. Callers register Arrow IPC as a buffer (`registerArrowTable`), a chunked stream (`registerArrowStream`), or complete batch payloads (`registerArrowBatches`), or query sources directly (e.g. `read_parquet`). Results leave as Arrow IPC bytes; JSON rows are decoded in transport (`arrowIpcToJsonRows`).

## Usage

```typescript
import type {
  QueryEngine,
  DataFrame,
  DataFrameStorage,
} from "@dashframe/engine";

// Also re-exports all @dashframe/types
import type { UUID, Field, Metric } from "@dashframe/engine";
```

## Core Interfaces

### QueryEngine

Executes SQL queries against registered tables:

```typescript
interface QueryEngine {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  isReady(): boolean;
  queryArrow(
    sql: string,
    params?: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  queryArrowBatches(
    sql: string,
    params?: readonly unknown[],
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array>;
  registerArrowTable(
    name: string,
    arrow: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void>;
  registerArrowStream(
    name: string,
    chunks: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void>;
  registerArrowBatches(
    name: string,
    batches: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void>;
  unregisterTable(name: string): Promise<void>;
  hasTable(name: string): boolean;
  getTableNames(): string[];
}
```

### DataFrameStorage

Persists DataFrame binary data:

```typescript
interface DataFrameStorage {
  save(id: UUID, data: Uint8Array): Promise<void>;
  load(id: UUID): Promise<Uint8Array | null>;
  delete(id: UUID): Promise<void>;
  // These three optional methods are an all-or-nothing reversible-delete group.
  stageDelete?(id: UUID): Promise<string | null>;
  commitDelete?(token: string): Promise<void>;
  rollbackDelete?(token: string): Promise<void>;
  // Independently optional startup recovery for staged deletes and save temps.
  recoverStagedDeletes?(referencedIds: readonly UUID[]): Promise<void>;
  // Independently optional probe used to decide whether recovery needs a
  // retained-snapshot durability flush before resolving delete tokens.
  hasPendingDataFrameDeletes?(): Promise<boolean>;
  exists(id: UUID): Promise<boolean>;
  list(): Promise<UUID[]>;
  getUsage(): Promise<{ count: number; totalBytes?: number }>;
}
```

### DataFrame

Lightweight storage reference — metadata and location, not the row data itself
(defined in `@dashframe/types`, re-exported here):

```typescript
interface DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameStorageLocation;
  readonly fieldIds: UUID[];
  readonly primaryKey?: string | string[];
  readonly createdAt: number;

  toJSON(): DataFrameJSON;
  getStorageType(): string;
}
```

## Connector Pattern

Base classes for data source connectors:

```typescript
import {
  BaseConnector,
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";

// File-based connector (CSV, Excel, JSON)
class CsvConnector extends FileSourceConnector {
  async parseFile(file: File): Promise<FileParseResult> { ... }
}

// Remote API connector (Notion, Airtable)
class NotionConnector extends RemoteApiConnector {
  async connect(config: Record<string, string>): Promise<RemoteDatabase[]> { ... }
  async fetchData(database: RemoteDatabase): Promise<DataFrameData> { ... }
}
```

## Query Types

```typescript
import type {
  FilterOperator, // "=" | "!=" | ">" | "<" | ...
  FilterPredicate, // { column, operator, value }
  SortDirection, // "asc" | "desc"
  SortOrder, // { column, direction }
  AggregationFunction, // "sum" | "avg" | "count" | ...
  Aggregation, // { column, function, alias }
  JoinType, // "inner" | "left" | "right" | "full"
  JoinOptions, // { table, on, type }
} from "@dashframe/engine";
```

## Implementations

- **`@dashframe/engine-server`** — primary: native DuckDB pipeline (`NativeDuckDBEngine`, Arrow data path, placement policy)
- **`@dashframe/engine-browser`** — retained DuckDB-WASM, IndexedDB, and BrowserDataFrame implementation; local-file import still depends on it pending server ingestion
