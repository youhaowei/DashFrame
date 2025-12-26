# State Management Architecture

This document details the web app's state management patterns, storage locations, and data flows.

## Core Concepts

**Entity Hierarchy:**

```
DataSource → DataTable → Field/Metric
                      ↘ Insight → InsightMetric
                               ↘ Visualization
```

**Entities (stored in Dexie/IndexedDB):**

- **`DataSource`** - Connection/credentials (Local, Notion, PostgreSQL)
- **`DataTable`** - Table/file representation with schema
- **`Field`** - User-facing columns with customization (UUID references)
- **`Metric`** - Aggregation definitions (sum, avg, count, etc.)
- **`Insight`** - User-defined query selecting fields/metrics from a table
- **`Visualization`** - Mosaic vgplot spec referencing an insight's DataFrame

**Client-side only:**

- **`DataFrame`** - Class with storage reference (metadata in localStorage, data in IndexedDB)
- **`QueryBuilder`** - SQL execution engine (loads data into DuckDB on-demand)

## State Split: Storage Locations

| Data               | Location               | Reason                              |
| ------------------ | ---------------------- | ----------------------------------- |
| DataSources        | Dexie (IndexedDB)      | User-owned, local-first             |
| DataTables         | Dexie (IndexedDB)      | Separate table with FK              |
| Fields/Metrics     | Dexie (IndexedDB)      | Nested in DataTables                |
| Insights           | Dexie (IndexedDB)      | Query configurations                |
| Visualizations     | Dexie (IndexedDB)      | vgplot specs                        |
| DataFrame metadata | Dexie (IndexedDB)      | Small entries (id, name, rowCount)  |
| DataFrame data     | IndexedDB (idb-keyval) | Arrow IPC binary data               |
| Active entity      | URL params             | Shareable, browser history          |
| UI state           | React useState         | Ephemeral, component-local          |
| DuckDB tables      | Memory                 | Loaded on-demand from Arrow buffers |

**Important**: DataFrame binary data is stored in IndexedDB as Arrow IPC format via `idb-keyval`. This avoids the 5-10MB localStorage quota limit.

## Dexie Query Patterns

```typescript
// Reactive hooks from @dashframe/core-dexie
const { data: sources, isLoading } = useDataSources();
const { addLocal, setNotion, remove } = useDataSourceMutations();

// Conditional data loading
const { data: tables } = useDataTables(selectedSourceId);

// Loading state handling
if (isLoading) return <Loading />;
if (!sources?.length) return <EmptyState />;
```

## Stores

| Store                   | Status     | Purpose                                          |
| ----------------------- | ---------- | ------------------------------------------------ |
| `@dashframe/core-dexie` | **Active** | Entity persistence (DataSources, Insights, etc.) |
| `dataframes-store.ts`   | **Legacy** | DataFrame metadata (migrating to Dexie)          |

**Class Serialization Pattern:**

Stores hold plain serializable objects, classes reconstructed on retrieval:

```typescript
// Store holds plain objects
dataFrames: Map<UUID, DataFrameSerialization>

// Reconstruct class on retrieval
get(id: UUID): DataFrame {
  const data = this.dataFrames.get(id);
  return data ? DataFrame.fromJSON(data) : undefined;
}
```

## Key Design Decisions

- **Dexie for persistence** - Reactive hooks, automatic IndexedDB sync
- **Route-based navigation** - Active entity from URL, not store state
- **Schema separation** - sourceSchema (discovered) vs fields (user-defined)
- **UUID-based field references** - Formulas use UUIDs, enabling renames
- **Sample-first loading** - 100-row preview for instant UX
- **Semantic type preservation** - Source types enable smart features
- **Rule-based suggestions** - Client-side heuristics (no AI/GPT)

## Data Flows

**Two Modes: Source Tables vs Query Results**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SOURCE DATA (Persisted)              QUERY RESULTS (Direct)            │
│  ───────────────────────              ──────────────────────            │
│  CSV/Notion → Arrow IPC → IndexedDB   SQL query → vgplot                │
│            → DuckDB table             (no storage, no temp table)       │
│            → DataFrame reference                                        │
│                                                                         │
│  Survives refresh                     Ephemeral, re-run as needed       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Source Data (CSV, Notion)** - persisted as tables:

```
Upload/Sync → Arrow IPC → IndexedDB → DataFrame reference
                                           ↓
                                DuckDB loads as table (on-demand)
```

**Query Results** - rendered directly, no storage:

```
SELECT ... FROM source_table JOIN other_table ...
         ↓
    DuckDB executes
         ↓
    vgplot renders directly from result
    (no temp table, no DataFrame, no storage)
```

**Notion Flow:**

```
Phase 1: Discovery
  Connect → Notion DataSource
         → Fetch schema → Create DataTable (no data yet)

Phase 2: Sync
  User syncs database
         → Fetch rows → Arrow IPC → IndexedDB
         → DataFrame reference
         → DuckDB table

Phase 3: Query
  Any SQL query → vgplot renders directly
```

**Key Insight**: Only source data is stored in DuckDB tables. Query results (joins, aggregations, filters) render directly to vgplot - no intermediate storage.

## Why This Design?

**Symmetric structure**: All sources work the same way - reduces complexity, easier to add new source types

**Cached vs Remote**:

- Notion doesn't support rich querying → cache as DataFrame, run transforms locally
- PostgreSQL supports full SQL → execute queries remotely, return DataFrames on-demand
- CSV is already local → load immediately into DataFrame

**Global Insights**: Can join DataTables from different sources (e.g., CSV + Notion + PostgreSQL)

## Persistence

```
Dexie (IndexedDB):
  dataSources, dataTables, insights, visualizations, dashboards

idb-keyval (IndexedDB):
  dashframe:arrow:*  (Arrow IPC binary data - actual DataFrame content)
```

**Storage Model:**

- Entity data in Dexie (structured, indexed, reactive)
- Arrow IPC in idb-keyval (binary blobs, keyed by DataFrame ID)
- DuckDB tables for source data (loaded from Arrow IPC on-demand)
- Query results render directly to vgplot (no storage)

**Key Optimization:** Query results (joins, filters, aggregations) are never stored. vgplot renders directly from DuckDB query execution.

**Future Enhancement - Parquet Compression:**
Currently using Arrow IPC for fast zero-copy loading. For large datasets, Parquet would reduce IndexedDB storage by 2-5x through columnar compression. Trade-off: decompression overhead on each page load.

## Action-Based Flow Architecture

The visualization creation flow uses an action-based model rather than rigid step sequences.

**Action Hub Pattern**: The create-visualization page (`/insights/[id]/create-visualization`) serves as a central hub:

- Create visualization from recommendations (click suggestion cards)
- Create custom visualization (opens builder)
- Join with another dataset (opens join flow modal)

**Auto-Navigation**: When a data source is selected:

1. Creates a draft insight
2. Navigates to the create-visualization page
3. Shows data preview and available actions

**Modular Actions**: Each action is implemented as a separate component:

- `JoinFlowModal` - Standalone modal for join operations
- `NotionInsightConfig` - Notion-specific insight configuration
- `CreateVisualizationContent` - Source selection and routing

**Benefits:**

- **Extensibility**: Add new actions by creating components and adding buttons to the action hub
- **Separation of Concerns**: Each action is isolated and independently testable
- **No Step Management**: No need to track step state or handle step transitions
- **Flexible Navigation**: Actions can navigate to different pages or open modals as needed
