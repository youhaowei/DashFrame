# DashFrame Architecture Overview

Inspired by the Data Engine Rebuild architecture [Notion](https://www.notion.so/youhaowei/Data-Engine-Rebuild-Architecture-Overview-25ed48ccaf5480549c5ffd0c60b5d5e2)

## Vision

DashFrame aims to become a flexible business intelligence surface focused on transforming structured data into expressive visual narratives. The MVP validates the core pipeline: CSV upload → DataFrame → Vega-Lite chart.

## Domain Model Snapshot

- **Table** – physical database table (future scope)
- **View** – saved SQL representation (future scope)
- **Model** – semantic layer modeling joins, dimensions, and measures (future scope)
- **Visualization** – declarative recipe for charts (data-free spec referencing a model)
- **Data Frame** – runtime tabular result (columns + rows) injected into visualization rendering
- **Document** – arrangement of visualizations in dashboards, canvases, or reports (future scope)

Current MVP focuses on producing a `DataFrame` from a CSV upload and rendering a chart using Vega-Lite.

## Tech Stack (Current MVP)

- **Next.js (App Router)** for the builder UI
- **Tailwind CSS v4** for styling
- **Papaparse** for CSV parsing
- **Vega-Lite + Vega Embed** for chart rendering (dynamic client component)
- **Zustand + Immer** for state management with automatic persistence
- **tRPC** for type-safe API calls (Notion integration)

## System Flow (MVP)

```
CSV Upload → DataFrame (columns + rows) → toVegaLite() → Vega-Lite Chart
```

The upload form parses CSV into a typed `DataFrame`, stored client-side. `buildVegaLiteSpec` produces a Vega-Lite spec while `VegaChart` embeds it, feeding table rows as inline values.

## Roadmap Highlights

1. **MVP** – CSV upload → DataFrame → Chart preview
2. **Customisation** – expose mark type, colour palette, and formatting controls
3. **Builder Enhancements** – field mapping, measure/dimension selection, encodings
4. **Semantic Layer** – models from tables/views, transform graph, computed fields
5. **Documents** – dashboards and rich text story telling via TipTap
6. **Operational Services** – WorkOS auth, Convex persistence, scheduling, history/undo

Convex and additional backend services are deferred until after the first milestone proves the front-end pipeline.

## State Management Architecture

### Core Concepts

**Entity Hierarchy:**

- `DataSource` (CSV or Notion) - Where data comes from
  - `DataEntity` - Has direct DataFrame (CSV)
  - `DataConnection` - Requires insights to generate DataFrames (Notion)
- `Insight` - Query configuration (SELECT dimensions FROM table) - nested in DataConnection
- `DataFrame` - Data snapshot with source tracking + timestamp
- `Visualization` - Full Vega-Lite spec + DataFrame reference

### Three Zustand Stores

1. **dataSourcesStore** - CSV sources + Notion connections (with nested insights Map)
2. **dataFramesStore** - Unified DataFrame storage with metadata
3. **visualizationsStore** - Vega-Lite specs + active visualization tracking

### Key Design Decisions

- **Immer middleware** - Clean immutable updates without manual spreading
- **Automatic persistence** - Zustand persist handles all localStorage (no manual calls)
- **UUID-based** - All entities use `crypto.randomUUID()`
- **Map storage** - O(1) lookups, custom serialization for persistence
- **Insights as nested entities** - Stored within their parent DataConnection
- **Source tracking** - DataFrames know their origin (dataSourceId + optional insightId)

### Data Flows

**CSV**: Upload → DataSource + DataFrame → Visualization
**Notion**: Connect → Insight → DataFrame → Visualization (refreshable)

### Persistence

```
localStorage keys:
  dash-frame:data-sources
  dash-frame:dataframes
  dash-frame:visualizations
```

## Naming Notes

- Product and architectural references use the `DashFrame` name.
- Workspace packages and config utilities follow the kebab-case `@dash-frame/*` scope (e.g. `@dash-frame/dataframe`) to stay aligned with npm conventions.
