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

## Visualization Rendering Pipeline

DashFrame uses a pluggable chart rendering system that separates data, orchestration, and rendering concerns.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          VISUALIZATION RENDERING PIPELINE                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  Data Source │     │   DuckDB     │     │   Insight    │     │Visualization│
│  (CSV/Notion)│────▶│   (WASM)     │────▶│  (Query)     │────▶│  (Config)   │
└──────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
                            │                                         │
                            │         ┌───────────────────────────────┘
                            │         │
                            ▼         ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │                    Chart                          │
                     │  React component that orchestrates chart rendering       │
                     │  • Receives: tableName, visualizationType, encoding      │
                     │  • Delegates to appropriate renderer via registry        │
                     └─────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │                  ChartRenderer Interface                 │
                     │  render(container, type, config) → cleanup()            │
                     └─────────────────────────────────────────────────────────┘
                          │                    │                    │
                    ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
                    │VgplotRenderer│   │ D3Renderer │   │CustomRenderer│
                    │bar,line,area │   │sankey,tree │   │your types   │
                    │scatter       │   │funnel      │   │             │
                    └──────────────┘   └────────────┘   └─────────────┘
                          │                    │                    │
                          ▼                    ▼                    ▼
                    ┌──────────┐         ┌──────────┐         ┌──────────┐
                    │  Mosaic  │         │    D3    │         │  Custom  │
                    │Coordinator│        │  Library │         │  Logic   │
                    └────┬─────┘         └────┬─────┘         └────┬─────┘
                         │                    │                    │
                         └────────────────────┼────────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │   DuckDB Query  │
                                    │   (via table)   │
                                    └────────┬────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │  SVG / Canvas   │
                                    │    Rendering    │
                                    └─────────────────┘
```

### Data Flow

1. **Data Ingestion**: CSV/Notion → Arrow IPC → IndexedDB → DuckDB Table
2. **Query Execution**: Insight (filters, aggregations) → DuckDB SQL → Result Set
3. **Chart Rendering**: Chart receives `tableName`, `visualizationType`, `encoding`
4. **Renderer Dispatch**: Registry maps type to appropriate renderer
5. **Render Execution**: Renderer builds marks, Mosaic generates SQL, DuckDB executes, SVG renders
6. **Cleanup**: Cleanup function called on unmount

### Key Design Decisions

- **Encoding-driven**: Charts are configured via encoding (x, y, color, size), not full specs
- **Query pushdown**: Aggregations happen in DuckDB, not JavaScript
- **Pluggable renderers**: New chart types only require implementing ChartRenderer interface
- **Table name references**: Charts reference DuckDB tables by name (`df_${dataFrameId}`)

### Packages

| Package                    | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `@dashframe/core`          | ChartRenderer types, ChartConfig interface |
| `@dashframe/visualization` | VisualizationProvider, registry, renderers |

### Adding New Chart Types

To add a custom chart type (e.g., Sankey diagram):

1. Create renderer implementing `ChartRenderer` interface
2. Register with `registerRenderer(renderer)`
3. Add type to `VisualizationType` in `@dashframe/core`
4. Chart automatically dispatches to your renderer

```typescript
// Example: Custom D3 Sankey renderer
const sankeyRenderer: ChartRenderer = {
  supportedTypes: ["sankey"],
  render(container, type, config) {
    // D3 Sankey implementation
    return () => (container.innerHTML = "");
  },
};

registerRenderer(sankeyRenderer);
```

## Detailed Documentation

| Topic                   | Location                            |
| ----------------------- | ----------------------------------- |
| Core types & data model | `packages/core/README.md`           |
| Engine interfaces       | `packages/engine/README.md`         |
| DuckDB integration      | `packages/engine-browser/README.md` |
| Persistence             | `packages/core-dexie/README.md`     |
| UI components           | `docs/ui-components.md`             |
| Visualization rendering | `packages/visualization/README.md`  |
| State & UI flows        | `apps/web/STATE-MANAGEMENT.md`      |
| Security headers        | `apps/web/lib/security-headers.ts`  |

## Security Architecture

### Content Security Policy (CSP)

DashFrame implements a comprehensive Content Security Policy to protect against XSS and other injection attacks. The CSP is configured in `apps/web/lib/security-headers.ts`.

#### Key CSP Directives

| Directive                   | Value                                                                            | Purpose                                          |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `default-src`               | `'self'`                                                                         | Only allow resources from same origin by default |
| `script-src`                | `'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: cdn.jsdelivr.net` | See below for rationale                          |
| `frame-ancestors`           | `'none'`                                                                         | Prevent clickjacking attacks                     |
| `upgrade-insecure-requests` | (production only)                                                                | Force HTTPS                                      |

#### Why `'unsafe-eval'` is Required

DashFrame's in-browser analytics engine uses:

1. **DuckDB-WASM** - SQL analytics engine compiled to WebAssembly
2. **Apache Arrow** - Columnar data format for efficient data transfer

Apache Arrow uses dynamic code generation internally for:

- Schema-to-accessor mapping
- Optimized field readers/writers
- Type-specific serialization

This dynamic code generation requires `'unsafe-eval'` in CSP. Without it, file uploads fail with:

```
EvalError: Evaluating a string as JavaScript violates the following
Content Security Policy directive because 'unsafe-eval' is not an
allowed source of script
```

#### Security Mitigations

Despite requiring `'unsafe-eval'`, DashFrame maintains strong security through:

1. **No user code execution** - All data is processed through sanitized pipelines
2. **Strict origin controls** - `default-src 'self'` limits where resources load from
3. **No framing** - `frame-ancestors 'none'` prevents clickjacking
4. **HTTPS enforcement** - `upgrade-insecure-requests` in production
5. **Minimal permissions** - `Permissions-Policy` disables unused browser APIs
6. **Input validation** - All file uploads validated before processing

#### Alternatives Considered

| Alternative            | Why Not Chosen                                        |
| ---------------------- | ----------------------------------------------------- |
| WASM-only Arrow        | No production-ready implementation exists for browser |
| Custom serialization   | Would lose DuckDB compatibility and performance       |
| Server-side processing | Breaks local-first architecture principle             |

The trade-off is acceptable because:

- DashFrame processes structured data (CSV, JSON), not executable content
- All processing happens in isolated contexts (no user scripts)
- The attack surface is limited to data injection, mitigated by validation
