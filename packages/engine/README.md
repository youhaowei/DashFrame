# @dashframe/engine

Abstract engine interfaces for DashFrame computation. This package defines contracts that can be implemented for different runtimes.

## Installation

```bash
bun add @dashframe/engine
```

## Overview

The engine package defines runtime-agnostic interfaces:

| Interface          | Real implementation today                         |
| ------------------ | ------------------------------------------------- |
| `QueryEngine`      | `NativeDuckDBEngine` (`@dashframe/engine-server`) |
| `DataFrameStorage` | IndexedDB (`@dashframe/engine-browser`)           |
| `DataFrame`        | `BrowserDataFrame` (`@dashframe/engine-browser`)  |

Primary path is **server-side native DuckDB** (`NativeDuckDBEngine`). Desktop already uses it; web is meant to share the same server process once headless `serve` wires the engine. DuckDB-WASM helpers in `@dashframe/engine-browser` are a **backup** path and do not implement `QueryEngine`.

This package has no shared `QueryPlanner` / push-down API. Connectors may still run remote queries themselves (e.g. Postgres table-reference fetches push LIMIT/OFFSET server-side); that is connector-local, not a cross-engine planner.

`NativeDuckDBEngine` is a partial `QueryEngine`: `registerTable(DataFrame)` throws — callers upload Arrow IPC via `registerArrowTable` (or query sources directly, e.g. `read_parquet`). The interface still lists `registerTable` for the contract; the native engine documents the restriction at the throw site.

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
  query(sql: string): Promise<QueryResult>;
  registerTable(name: string, data: DataFrame): Promise<void>;
  unregisterTable(name: string): Promise<void>;
  isReady(): boolean;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}
```

On `NativeDuckDBEngine`, use `registerArrowTable` for uploads — `registerTable` is intentionally unsupported.

### DataFrameStorage

Persists DataFrame binary data:

```typescript
interface DataFrameStorage {
  save(id: UUID, data: Uint8Array): Promise<void>;
  load(id: UUID): Promise<Uint8Array | null>;
  delete(id: UUID): Promise<void>;
  exists(id: UUID): Promise<boolean>;
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
- **`@dashframe/engine-browser`** — backup / transitional web helpers (DuckDB-WASM, IndexedDB, BrowserDataFrame)
