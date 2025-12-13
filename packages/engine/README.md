# @dashframe/engine

Abstract engine interfaces for DashFrame computation. This package defines contracts that can be implemented for different runtimes.

## Installation

```bash
pnpm add @dashframe/engine
```

## Overview

The engine package defines runtime-agnostic interfaces:

| Interface          | Browser Implementation | Server Implementation (Future) |
| ------------------ | ---------------------- | ------------------------------ |
| `QueryEngine`      | DuckDB-WASM            | DuckDB native / PostgreSQL     |
| `DataFrameStorage` | IndexedDB              | Filesystem / S3                |
| `QueryPlanner`     | BrowserQueryPlanner    | ServerQueryPlanner             |

This separation allows the same application code to run on different platforms by swapping the engine implementation.

## Usage

```typescript
import type {
  QueryEngine,
  DataFrame,
  DataFrameStorage,
  QueryPlanner,
  ExecutionPlan,
} from "@dashframe/engine";

// Also re-exports all @dashframe/core types
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

Immutable data container with serialization support:

```typescript
interface DataFrame {
  readonly id: UUID;
  readonly columns: TableColumn[];
  readonly rowCount: number;

  toArray(): Record<string, unknown>[];
  toArrowIPC(): Uint8Array;
  getColumn<T = unknown>(name: string): T[];
}
```

## QueryPlanner

The `QueryPlanner` determines the optimal execution strategy for queries based on data location and connector capabilities.

### Execution Strategies

```typescript
type ExecutionPlan =
  | { strategy: "local"; reason: "data-cached" }
  | {
      strategy: "remote";
      reason: "push-down";
      connector: RemoteApiConnector;
      remoteQuery: Partial<Query>;
    }
  | {
      strategy: "hybrid";
      reason: "no-cache" | "connector-limitation" | "partial-push-down";
      fetchFirst: boolean;
    };
```

### Strategy Selection

1. **Local** - Data exists in cache → execute with local engine
2. **Remote** - Connector supports push-down → execute on source
3. **Hybrid** - Fetch data first, then execute locally

### Connector Capabilities

Connectors can implement `QueryPushDownCapable` to advertise remote execution support:

```typescript
interface QueryPushDownCapable {
  supportsQueryPushDown(): boolean;
  supportedPushDownOperations(): PushDownOperation[];
  canFullyPushDown?(query: Query): boolean;
}

// Type guard
import { isQueryPushDownCapable } from "@dashframe/engine";

if (isQueryPushDownCapable(connector)) {
  const ops = connector.supportedPushDownOperations();
}
```

| Connector  | Push-Down Support         |
| ---------- | ------------------------- |
| CSV        | None (file is local)      |
| Notion     | Limited (filter, sort)    |
| PostgreSQL | Full (all SQL operations) |

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

- **`@dashframe/engine-browser`** - Browser implementation with DuckDB-WASM
- **`@dashframe/engine-server`** - Server implementation (future)
- **`@dashframe/engine-mobile`** - Mobile implementation (future)
