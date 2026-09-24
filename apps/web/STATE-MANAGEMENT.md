# State Management Architecture

This document details the web app's state management patterns, storage locations, and data flows.

The data plane is server-side: Arrow snapshots on the host, DuckDB in the host process, charts via the Mosaic connector. There is no in-browser DuckDB or IndexedDB frame store.

## Core Concepts

**Entity Hierarchy:**

```
DataSource → DataTable → Field/Metric
                      ↘ Insight → InsightMetric
                               ↘ Visualization
```

**Entities (stored in Convex):**

- **`DataSource`** - Connection/credentials (Local, Notion, PostgreSQL)
- **`DataTable`** - Table/file representation with schema
- **`Field`** - User-facing columns with customization (UUID references)
- **`Metric`** - Aggregation definitions (sum, avg, count, etc.)
- **`Insight`** - User-defined query selecting fields/metrics from a table
- **`Visualization`** - Mosaic vgplot spec referencing an insight's DataFrame

**Client-side only:**

- Chart SQL is composed by Mosaic and posted to the host Arrow path.
- Local file ingest encodes Arrow in the browser and uploads it to the host.

## State Split: Storage Locations

| Data               | Location       | Reason                                |
| ------------------ | -------------- | ------------------------------------- |
| DataSources        | Convex         | Connector configuration metadata      |
| DataTables         | Convex         | Artifact metadata and schema          |
| Fields/Metrics     | Convex         | Nested in artifact definitions        |
| Insights           | Convex         | Query configurations                  |
| Visualizations     | Convex         | vgplot specs                          |
| DataFrame metadata | Convex         | Pointers to host files                |
| DataFrame data     | Host files     | Arrow IPC snapshots                   |
| Active entity      | URL params     | Shareable, browser history            |
| UI state           | React useState | Ephemeral, component-local            |
| DuckDB tables      | Host process   | Server native engine, not the browser |

**Important**: DataFrame binary data is stored as Arrow IPC files on the host. The browser does not keep a DuckDB or IndexedDB copy of frames.

## Convex Query Patterns

```typescript
// Reactive hooks from @/data
const { data: sources, isLoading } = useDataSources();
const { addLocal, setNotion, remove } = useDataSourceMutations();

// Conditional data loading
const { data: tables } = useDataTables(selectedSourceId);

// Loading state handling
if (isLoading) return <Loading />;
if (!sources?.length) return <EmptyState />;
```

## Stores

| Store    | Status     | Purpose                                           |
| -------- | ---------- | ------------------------------------------------- |
| `@/data` | **Active** | Convex-backed artifacts (sources, insights, etc.) |

## Key Design Decisions

- **Convex for persistence** - Reactive artifact queries and mutations
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
│  CSV/Notion → Arrow IPC → host file   SQL query → vgplot                │
│            → server DuckDB table      (via Mosaic connector)            │
│            → DataFrame reference                                        │
│                                                                         │
│  Survives refresh                     Ephemeral, re-run as needed       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Source Data (CSV, Notion)** - persisted as tables:

```
Upload/Sync → Arrow IPC → host file → DataFrame reference
                                           ↓
                                Server DuckDB loads as table (on-demand)
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
         → Fetch rows → Arrow IPC → host file
         → DataFrame reference
         → Server DuckDB table

Phase 3: Query
  Any SQL query → vgplot renders directly
```

**Key Insight**: Source data is stored as host Arrow files and registered in server DuckDB. Chart SQL is posted to that engine; vgplot does not run DuckDB in the browser.

## Why This Design?

**Symmetric structure**: All sources work the same way - reduces complexity, easier to add new source types

**Cached vs Remote**:

- Notion doesn't support rich querying → cache as DataFrame, run transforms locally
- PostgreSQL supports full SQL → execute queries remotely, return DataFrames on-demand
- CSV is already local → load immediately into DataFrame

**Global Insights**: Can join DataTables from different sources (e.g., CSV + Notion + PostgreSQL)

## Persistence

```
Convex:
  dataSources, dataTables, insights, visualizations, dashboards (metadata)

Host files:
  {uuid}.arrow  (Arrow IPC snapshots)
```

**Storage Model:**

- Artifact metadata in Convex
- Arrow IPC on the host, keyed by DataFrame ID
- DuckDB tables in the host process, registered from those files
- Chart queries go to the server Mosaic connector; vgplot does not run DuckDB in the browser

## Chart Editing Flow

A chart is edited in a tab inside its report (`/dashboards/$dashboardId?chart=<tab>`). The active tab lives in the URL; the set of open tabs lives in session storage.

- Every way into a chart that does not start from a report asks which report first (`ReportPickerDialog`): a data source's "Start a report", a draft's "Open chart", and onboarding (always a new report).
- A new chart opens as a tab with its table picked. It stays a draft until it has a field and a metric, then lands on the report as a tile and its tab takes the chart's name.
- Joins are configured at `/dashboards/$dashboardId/join/$insightId/$tableId?chart=`, and return to the chart's tab.
