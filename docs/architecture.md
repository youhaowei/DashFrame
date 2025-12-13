# DashFrame Architecture Overview

## Vision

DashFrame is a flexible business intelligence tool for transforming structured data into expressive visual narratives. The MVP validates: CSV/Notion → DataFrame → Mosaic vgplot chart.

## Domain Model

| Entity            | Description                                                     |
| ----------------- | --------------------------------------------------------------- |
| **DataSource**    | Connection/credentials (Local, Notion, PostgreSQL)              |
| **DataTable**     | Table/file with schema (discovered + user-defined fields)       |
| **Field**         | User-defined column with UUID reference, optional formula       |
| **Metric**        | Aggregation definition (sum, avg, count, etc.)                  |
| **Insight**       | Query selecting fields/metrics from a table                     |
| **Visualization** | Mosaic vgplot spec referencing an insight                       |
| **DataFrame**     | Lightweight reference to cached data (IndexedDB, future: S3/R2) |

## Tech Stack

| Layer           | Technology                 |
| --------------- | -------------------------- |
| UI Framework    | Next.js 16 (App Router)    |
| Styling         | Tailwind CSS v4, Shadcn/ui |
| Query Engine    | DuckDB-WASM                |
| Chart Rendering | Mosaic vgplot              |
| Data Format     | Arrow IPC                  |
| Persistence     | Dexie (IndexedDB)          |
| State           | Zustand                    |
| API Proxy       | tRPC                       |

## System Flow

```
SOURCE DATA:                    QUERY & RENDER:
CSV/Notion → Arrow IPC          Insight → SQL → DuckDB → vgplot
          → IndexedDB           (no intermediate storage)
          → DataFrame ref
```

DataFrame persists data across sessions. Query results render directly to vgplot.

## Package Architecture

```
packages/
  core/               # Pure types, zero dependencies
  engine/             # Abstract interfaces (QueryEngine, DataFrame, Storage)
  engine-browser/     # Browser implementation (DuckDB-WASM, IndexedDB)
  core-dexie/         # Dexie persistence for entities
  connector-csv/      # CSV file parsing
  connector-notion/   # Notion API integration
  ui/                 # Shared UI components
  eslint-config/      # Shared ESLint config
```

**Import Layering:** `core` → `engine` → `engine-browser` → connectors

See each package's README.md for detailed documentation.

## Route Structure

```
/                              → Dashboard
/data-sources                  → Data sources list
/data-sources/[sourceId]       → Data source detail
/insights                      → Insights list
/insights/[insightId]          → Insight detail
/visualizations                → Visualizations list
/visualizations/[vizId]        → Visualization detail
```

## Naming Conventions

- **Product**: `DashFrame` (PascalCase)
- **Packages**: `@dashframe/*` (lowercase)
- **Storage keys**: `dashframe:*` (lowercase)

## Detailed Documentation

| Topic                   | Location                            |
| ----------------------- | ----------------------------------- |
| Core types & data model | `packages/core/README.md`           |
| Engine interfaces       | `packages/engine/README.md`         |
| DuckDB integration      | `packages/engine-browser/README.md` |
| Persistence             | `packages/core-dexie/README.md`     |
| UI components           | `packages/ui/README.md`             |
| State & UI flows        | `apps/web/STATE-MANAGEMENT.md`      |
