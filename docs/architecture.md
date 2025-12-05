# DashFrame Architecture Overview

Inspired by the Data Engine Rebuild architecture [Notion](https://www.notion.so/youhaowei/Data-Engine-Rebuild-Architecture-Overview-25ed48ccaf5480549c5ffd0c60b5d5e2)

## Vision

DashFrame aims to become a flexible business intelligence surface focused on transforming structured data into expressive visual narratives. The MVP validates the core pipeline: CSV upload → DataFrame → Mosaic vgplot chart.

## Domain Model Snapshot

- **Table** – physical database table (future scope)
- **View** – saved SQL representation (future scope)
- **Model** – semantic layer modeling joins, dimensions, and measures (future scope)
- **Field** – user-defined column with UUID reference, optional formula, and semantic metadata
- **Metric** – aggregation definition (sum, avg, count, etc.) for quantitative analysis
- **Visualization** – declarative recipe for charts (data-free spec referencing a model)
- **DataFrame** – lightweight reference to cached data with explicit storage location (IndexedDB, future: S3/R2)
- **Document** – arrangement of visualizations in dashboards, canvases, or reports (future scope)

Current MVP focuses on producing a `DataFrame` from CSV/Notion sources and rendering charts using Mosaic vgplot (native DuckDB integration).

## Tech Stack (Current MVP)

- **Next.js (App Router)** for the builder UI
- **Tailwind CSS v4** for styling
- **Papaparse** for CSV parsing
- **DuckDB-WASM** for client-side SQL query execution
- **Mosaic vgplot** for declarative chart rendering (native DuckDB integration)
- **Arrow IPC** for columnar data storage in IndexedDB (future: Parquet for compression)
- **IndexedDB** for persistent binary data storage (via idb-keyval)
- **Zustand** for client-side state management (metadata + DataFrame references)
- **tRPC** for external API calls (Notion integration)

## System Flow (MVP)

**Query-only (join previews, exploration):**

```
SQL Query → DuckDB executes → vgplot renders from result
```

**Full persist (CSV upload, saved data):**

```
CSV Upload → Arrow IPC → IndexedDB → DataFrame → DuckDB → vgplot
```

vgplot renders directly from DuckDB query results - no intermediate storage needed for previews. DataFrame is only for persisting data across browser sessions.

## Convex Backend

**Location:** `/convex` (at repo root, separate from frontend apps)

**Tables:**

- `dataSources` - Data connections (local, notion, postgresql)
- `dataTables` - Tables within data sources
- `fields` - Columns in data tables
- `metrics` - Aggregations on data tables
- `insights` - User-defined queries/transformations
- `insightMetrics` - Metrics within insights
- `visualizations` - Saved visualization specs (Mosaic vgplot)

**Import Pattern:**

```typescript
import { api } from "@dashframe/convex";
import { useQuery, useMutation } from "convex/react";
import type { Id, Doc } from "@dashframe/convex/dataModel";
```

**Why Convex:**

- Eliminates SSR hydration mismatches (data fetched server-side)
- Real-time sync across tabs/devices
- Type-safe queries with generated types
- Built-in auth integration

**Route Structure:**

```
/                              → Dashboard (entity counts, quick actions)
/data-sources                  → Data sources list
/data-sources/[sourceId]       → Data source detail (tables, fields)
/insights                      → Insights list
/insights/[insightId]          → Insight detail (configure, preview)
/visualizations                → Visualizations list
/visualizations/[vizId]        → Visualization detail (chart, controls)
```

## Roadmap Highlights

1. **MVP** – CSV upload → DataFrame → Chart preview
2. **Customisation** – expose mark type, colour palette, and formatting controls
3. **Builder Enhancements** – field mapping, measure/dimension selection, encodings
4. **Semantic Layer** – models from tables/views, transform graph, computed fields
5. **Documents** – dashboards and rich text story telling via TipTap
6. **Operational Services** – WorkOS auth, Convex persistence, scheduling, history/undo

## State Management Architecture

### Core Concepts

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

- **`DataFrame`** - Class with storage reference (metadata in localStorage, data in IndexedDB)
- **`QueryBuilder`** - SQL execution engine (loads data into DuckDB on-demand)

### State Split: Storage Locations

| Data               | Location       | Reason                                         |
| ------------------ | -------------- | ---------------------------------------------- |
| DataSources        | localStorage   | User-owned, local-first (future: Convex)       |
| DataTables         | localStorage   | Nested in DataSources                          |
| Fields/Metrics     | localStorage   | Nested in DataTables                           |
| Insights           | localStorage   | Query configurations (future: Convex)          |
| Visualizations     | localStorage   | vgplot specs (future: Convex)                  |
| DataFrame metadata | localStorage   | Small entries (id, name, insightId, rowCount)  |
| DataFrame data     | IndexedDB      | Arrow IPC binary data (loaded via DuckDB)      |
| Active entity      | URL params     | Shareable, browser history                     |
| UI state           | React useState | Ephemeral, component-local                     |
| DuckDB tables      | Memory         | Loaded on-demand from IndexedDB Arrow buffers  |

**Important**: DataFrame data is stored in IndexedDB as Arrow IPC format, NOT in localStorage. This avoids the 5-10MB localStorage quota limit that would be exceeded by large CSV files.

### Convex Query Patterns

```typescript
// Fetch entity from route params (no hydration issues)
const { vizId } = useParams();
const visualization = useQuery(api.visualizations.get, { id: vizId });

// Conditional queries with "skip"
const insight = useQuery(
  api.insights.get,
  visualization?.insightId ? { id: visualization.insightId } : "skip"
);

// Navigation via router (replaces store's setActive)
const openViz = (id: string) => router.push(`/visualizations/${id}`);

// Loading state handling
if (visualization === undefined) return <Loading />;
if (visualization === null) return <NotFound />;
```

### Stores

| Store                     | Status     | Purpose                                        |
| ------------------------- | ---------- | ---------------------------------------------- |
| `dataframes-store.ts`     | **Active** | DataFrame metadata + storage references        |
| `data-sources-store.ts`   | **Active** | Local sources + DataTables (with Zustand)      |
| `insights-store.ts`       | **Active** | Insight configurations (InsightConfig objects) |
| `visualizations-store.ts` | **Active** | vgplot specs + visualization metadata          |

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

### Key Design Decisions

- **Server-first persistence** - Convex eliminates SSR hydration mismatches
- **Route-based navigation** - Active entity from URL, not store state
- **Schema separation** - sourceSchema (discovered) vs fields (user-defined)
- **UUID-based field references** - Formulas use UUIDs, enabling renames
- **Sample-first loading** - 100-row preview for instant UX
- **Semantic type preservation** - Source types enable smart features
- **Rule-based suggestions** - Client-side heuristics (no AI/GPT)

### Data Flows

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

### Why This Design?

**Symmetric structure**: All sources work the same way - reduces complexity, easier to add new source types

**Cached vs Remote**:

- Notion doesn't support rich querying → cache as DataFrame, run transforms locally
- PostgreSQL supports full SQL → execute queries remotely, return DataFrames on-demand
- CSV is already local → load immediately into DataFrame

**Global Insights**: Can join DataTables from different sources (e.g., CSV + Notion + PostgreSQL)

### Persistence

```
Convex (server):
  dataSources, dataTables, fields, metrics,
  insights, insightMetrics, visualizations

localStorage (client):
  dashframe:dataframes     (DataFrame metadata + storage references)
  dashframe:data-sources   (local source state)
  dashframe:insights       (insight configurations)

IndexedDB (client):
  dashframe:arrow:*        (Arrow IPC binary data - actual DataFrame content)
```

**Storage Model:**

- DataFrame metadata in localStorage (tiny, serializable) - **source data only**
- Arrow IPC in IndexedDB (columnar, zero-copy load) - **source data only**
- DuckDB tables for source data (loaded from Arrow IPC on-demand)
- Query results render directly to vgplot (no storage)

**Key Optimization:** Query results (joins, filters, aggregations) are never stored. vgplot renders directly from DuckDB query execution.

**Future Enhancement - Parquet Compression:**
Currently using Arrow IPC for fast zero-copy loading. For large datasets, Parquet would reduce IndexedDB storage by 2-5x through columnar compression. Trade-off: decompression overhead on each page load. Consider implementing when storage becomes a bottleneck.

## DataTable Schema Layers

DataTables separate **discovered schema** (what exists in source) from **user-defined analytical layer** (what users see and customize). This enables schema evolution without breaking user customizations.

**Three Layers:**

1. **Source Schema** - Discovered columns from source (Notion properties, CSV headers)
   - Includes original semantic types (Notion: status, relation, email; CSV: inferred types)
   - Synced during discovery/refresh with version tracking
   - System updates this layer automatically

2. **Fields** - User-facing columns with customization
   - Each field has UUID for stable formula references
   - Can rename without breaking references
   - Can hide columns (no field = hidden)
   - Can add calculated fields with formulas
   - References source columns via `basedOn` array

3. **Metrics** - Aggregation definitions (sum, avg, count, etc.)
   - Referenced by UUID in formulas
   - Always produce numeric output

**DataTable Lifecycle:**

1. **Discovered** - Schema fetched, fields auto-generated, no data cached
2. **Sample Loaded** - First 100 rows cached for instant preview
3. **Fully Synced** - Complete dataset cached, ready for analysis

## Fields and Metrics

**Fields** are user-facing columns that can be renamed, hidden, or calculated. Each field has a UUID for stable references in formulas, enabling name changes without breaking dependencies. Fields reference source columns via `basedOn` array (one column for simple fields, multiple for calculated fields).

**Metrics** define aggregations (sum, avg, count, min, max, count_distinct) over fields. Like fields, they use UUID references for stability.

**Key Design Choice - UUID References:**
Formulas reference other fields/metrics by UUID, not by name. This allows users to rename anything without breaking formulas. This avoids the "stable name ID" pattern which creates implementation complexity.

**Semantic Intelligence:**
Source columns preserve original types (Notion's status, relation, email, etc.). Fields can look up source semantic types via `basedOn` to enable smart features like filtering out email/URL fields from visualizations or detecting relation fields for join suggestions.

## Smart Visualization Suggestions

Rule-based heuristics suggest visualizations based on field types and cardinality. No AI/GPT calls - instant, free, privacy-preserving.

**Core Heuristics:**

- Categorical (low cardinality) + Count → Bar chart
- Two numeric fields → Scatter plot
- Date + Numeric → Time series line chart
- Date + Count → Activity timeline
- Categorical + Numeric → Aggregated bar chart

**Semantic Type Intelligence:**
Source column types inform suggestions. Notion `status` and `select` fields are prioritized for categorical charts. Fields like `email`, `url`, `phone_number` are filtered out. `created_time` and `last_edited_time` suggest activity tracking visualizations.

**Field Scoring:**
Prefer fields with 2-50 distinct values, penalize high null percentage, prioritize descriptive names (status, priority, category), avoid system fields in suggestions.

## Join Suggestions

Notion `relation` fields enable automatic join detection. Relations store page IDs from related databases, allowing high-confidence join suggestions: `Tasks.Project` → `Projects._notionId`.

**Confidence Levels:**

- **High** - Detected from Notion relation metadata
- **Medium** - Name-based matching (field "Project" → table "Projects")

Fallback heuristics include name matching with pluralization and common ID patterns.

## UI/UX Guidelines

### Component-First Approach

**Avoid custom divs with one-off Tailwind classes.** Use shadcn/ui components or create proper reusable components instead of inline styling.

**Prefer shadcn/ui components:**

- Use `<Card>`, `<CardHeader>`, `<CardContent>` instead of `<div className="border rounded-lg p-6">`
- Use `<Badge>` instead of `<span className="text-xs px-2 py-1 rounded-full">`
- Use `<Button>` variants instead of styled `<button>` or clickable `<div>` elements
- Leverage existing shadcn components: `<Dialog>`, `<Select>`, `<Checkbox>`, `<Input>`, etc.

**Create named components for repeated patterns:**

- If a div+Tailwind combination appears 3+ times, extract to a component
- Name components by **purpose** (e.g., `<SectionHeader>`, `<EmptyState>`) not appearance
- Place shared components in `components/ui/` (shadcn) or `components/shared/` (custom)

**When custom divs are acceptable:**

- Layout containers (flex/grid wrappers) with truly one-off positioning
- But consider if even these could use a `<Stack>` or `<Grid>` component for consistency

### Text & Typography

- **No UPPERCASE labels** - Use sentence case for all UI text (buttons, headers, badges)
- **Exception**: Acronyms like CSV, API, URL remain uppercase
- Remove all `uppercase` Tailwind utility classes from text elements
- Prefer semantic heading levels (`<h1>`, `<h2>`) with Tailwind for styling

### Visual Design System

**Spacing hierarchy:**

- `p-4` - Compact elements (buttons, small cards, inline badges)
- `p-6` - Standard cards and panels (most common)
- `p-8` - Spacious layouts (page containers, main sections)

**Border radius:**

- `rounded-2xl` - Main cards and top-level containers
- `rounded-xl` - Nested elements and secondary cards
- `rounded-full` - Circular badges and avatars only

**Icon sizing:**

- `h-4 w-4` - Inline icons (within buttons, next to text)
- `h-5 w-5` - Standalone icons (sidebar, empty states, headers)

**Consistent patterns:**

- If shadcn/ui doesn't provide a component and you need the pattern 3+ times, create a reusable component
- Document custom components in component files with JSDoc comments

### UX Pattern Consistency

- **Reuse workflows** - Same interaction patterns for similar actions across the app
- **Empty states** - Always include clear call-to-action with `<Button>` component
- **Error messages** - User-focused language (explain impact, not technical internals)
- **Helper text** - Maintain single source of truth for common messages (file size limits, API hints)
- **Loading states** - Provide visual feedback (spinners, skeleton screens) for async operations

### Metadata & Content

- **User-facing language** - Avoid technical jargon in page titles, descriptions, and labels
- **Metadata cleanup** - Remove implementation details from user-visible content
- **Helper text** - Write for users, not developers (e.g., "Stored locally in your browser" ✓, "localStorage key: dashframe:api-key" ✗)

### Accessibility

- **Icon-only buttons** require `aria-label` attributes
- **Form inputs** need proper `<label>` elements or aria-labels
- **Loading states** must provide feedback (`aria-busy`, `aria-live` regions)
- **Keyboard navigation** - All interactive elements accessible via keyboard
- **Color contrast** - Follow WCAG AA standards (Tailwind's default palette generally compliant)

## Action-Based Flow Architecture

The visualization creation flow uses an action-based model rather than rigid step sequences. This makes it easier to extend with new actions and provides a more flexible user experience.

### Key Concepts

**Action Hub Pattern**: The create-visualization page (`/insights/[id]/create-visualization`) serves as a central hub where users can take multiple actions:

- Create visualization from recommendations (click suggestion cards)
- Create custom visualization (opens builder)
- Join with another dataset (opens join flow modal)

**Auto-Navigation**: When a data source is selected, the system automatically:

1. Creates a draft insight
2. Navigates to the create-visualization page
3. Shows data preview and available actions

**Modular Actions**: Each action is implemented as a separate component:

- `JoinFlowModal` - Standalone modal for join operations
- `NotionInsightConfig` - Notion-specific insight configuration
- `CreateVisualizationContent` - Source selection and routing

### Benefits

- **Extensibility**: Add new actions by creating components and adding buttons to the action hub
- **Separation of Concerns**: Each action is isolated and independently testable
- **No Step Management**: No need to track step state or handle step transitions
- **Flexible Navigation**: Actions can navigate to different pages or open modals as needed

### Adding New Actions

To add a new action to the create-visualization page:

1. Create action component (modal, page, or inline UI)
2. Add button to sticky bottom actions bar in `create-visualization/page.tsx`
3. Handle action completion (navigate, update state, etc.)
4. Document the new action in the spec

Example:

```tsx
// In create-visualization/page.tsx
<Button onClick={() => setIsNewActionOpen(true)}>
  New Action
</Button>
<NewActionModal isOpen={isNewActionOpen} onClose={...} />
```

## Naming Notes

- Product and architectural references use the `DashFrame` name.
- Workspace packages and config utilities follow the lowercase `@dashframe/*` scope (e.g. `@dashframe/dataframe`) to stay aligned with npm conventions.

## DuckDB-WASM Integration

**Purpose:** Local query execution engine for Insights

**Why DuckDB:**

- 100x-1000x faster than JavaScript loops for aggregations
- Columnar storage (Arrow IPC) reduces memory usage
- SQL query interface for complex transforms
- Native integration with Mosaic vgplot for visualization
- Runs entirely client-side (no server needed)

**Architecture Flow:**

```
SOURCE DATA:
  CSV/Notion → Arrow IPC → IndexedDB → DataFrame reference
                                          ↓
                              DuckDB table (loaded on-demand)

QUERY & RENDER:
  Insight (config) → SQL Query → DuckDB executes → vgplot renders directly
                                (no intermediate storage)
```

**Data Storage Model:**

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

### Async Data Loading Pattern

Components access DataFrame data through the `useDataFrameData` hook, which handles async loading from IndexedDB via DuckDB:

```typescript
// Hook for async data loading
const { data, isLoading, error } = useDataFrameData(dataFrameId);

// data: LoadedDataFrameData | null (rows, columns when loaded)
// isLoading: boolean
// error: Error | null
```

**Key Patterns:**

- **Metadata-only**: Use `getEntry(id)` or `getDataFrameEntry(id)` for display (rowCount, name, etc.)
- **Full data**: Use `useDataFrameData(id)` hook for row/column access (triggers IndexedDB load)
- **Store state**: `DataFrameEntry` contains metadata + storage reference, NOT inline data

**Type Separation:**

```typescript
// Metadata (stored in localStorage via Zustand)
interface DataFrameEntry extends DataFrameSerialization {
  name: string;
  insightId?: UUID;
  rowCount?: number;
  columnCount?: number;
}

// Loaded data (from IndexedDB via DuckDB)
interface LoadedDataFrameData {
  rows: Record<string, unknown>[];
  columns: DataColumn[];
}
```

This separation avoids the localStorage quota limit (~5-10MB) by storing only metadata in localStorage while large data lives in IndexedDB.

### Three-Layer Architecture

#### 1. DataFrame Class (Persistence Reference)

**Role:** Lightweight reference to persisted data. Not needed for in-session previews.

DataFrame is primarily for **persistence across sessions** - it knows WHERE data is stored (extensible for future cloud storage). For quick previews, data lives directly in DuckDB temp tables without DataFrame involvement.

```typescript
// Storage location discriminated union
type DataFrameStorage =
  | { type: "indexeddb"; key: string } // Browser IndexedDB
  | { type: "s3"; bucket: string; key: string } // AWS S3 (future)
  | { type: "r2"; accountId: string; key: string }; // Cloudflare R2 (future)

class DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameStorage;
  readonly primaryKey?: string | string[];

  // Entry point to query operations
  load(conn: AsyncDuckDBConnection): QueryBuilder;

  // Serialization (only metadata stored in localStorage)
  toJSON(): DataFrameSerialization;
  static fromJSON(data: DataFrameSerialization): DataFrame;

  // Factory for creating new DataFrames
  static async create(
    arrowBuffer: Uint8Array,
    options?: { storageType?: "indexeddb"; primaryKey?: string | string[] },
  ): Promise<DataFrame>;
}
```

**Key Points:**

- DataFrame stores NO data in memory - just a reference
- Explicit about WHERE data lives (extensible for cloud storage)
- `load(conn)` returns QueryBuilder for all operations
- Trivial serialization (just metadata, not data)

**When DataFrame is Used:**

- **Persistence**: Save data across browser sessions (Arrow IPC in IndexedDB)
- **Sharing**: Reference data by ID across components
- **Cloud storage**: Future S3/R2 integration

**When DataFrame is NOT Needed:**

- **Previews**: Data goes directly to DuckDB temp table → vgplot
- **Exploratory queries**: Results stay in DuckDB, render immediately
- **Transient analysis**: No need to persist every intermediate result

#### 2. QueryBuilder Class (SQL Generation)

**Role:** Builds SQL queries from chained operations. Results render directly to vgplot.

```typescript
class QueryBuilder {
  private baseTable: string; // DuckDB table name
  private operations: Operation[] = [];

  // Operation chaining (deferred execution)
  filter(predicates: FilterPredicate[]): QueryBuilder;
  sort(orderBy: SortOrder[]): QueryBuilder;
  groupBy(columns: string[], aggregations?: Aggregation[]): QueryBuilder;
  join(otherTable: string, options: JoinOptions): QueryBuilder;
  limit(count: number): QueryBuilder;
  select(columns: string[]): QueryBuilder;

  // Generate SQL (for vgplot to execute)
  sql(): string;
}
```

**Key Point:** QueryBuilder generates SQL, vgplot executes it directly. No intermediate result storage.

**Source Table Loading** (separate from QueryBuilder):

```typescript
async function loadSourceTable(
  dataFrame: DataFrame,
  conn: AsyncDuckDBConnection,
): Promise<string> {
  const tableName = `df_${dataFrame.id.replace(/-/g, "_")}`;

  // Check if already loaded
  const exists = await conn.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = '${tableName}'`,
  );
  if (exists.numRows > 0) return tableName;

  // Load Arrow IPC from IndexedDB
  const arrowBuffer = await loadArrowData(dataFrame.storage.key);
  await conn.insertArrowFromIPCStream(arrowBuffer, { name: tableName });

  return tableName;
}
```

#### 3. Insight Class (Query Configuration)

**Role:** User-defined analysis configuration. Generates SQL for vgplot to execute directly.

**Important:** Insight references **DataTable**, not DataFrame. It generates SQL that vgplot executes - no intermediate result storage.

```typescript
type InsightConfig = {
  id?: UUID;
  name: string;
  baseTableId: UUID; // References DataTable
  selectedFields?: UUID[]; // Field IDs from DataTable
  metrics?: InsightMetric[];
  filters?: FilterPredicate[];
  groupBy?: string[];
  orderBy?: SortOrder[];
  limit?: number;
};

class Insight {
  constructor(config: InsightConfig);

  get id(): UUID;
  get config(): InsightConfig;

  // Generate SQL (vgplot executes directly)
  toSQL(dataSourcesStore): string;

  // Create modified copy (immutable updates)
  with(updates: Partial<InsightConfig>): Insight;

  toJSON(): InsightConfig;
  static fromJSON(config: InsightConfig): Insight;
}
```

**Flow:**

```
Insight.toSQL()
  → Look up DataTable → get DuckDB table name
  → Generate SELECT with fields, metrics, filters, groupBy
  → Return SQL string
  → vgplot executes and renders directly
```

### Usage Examples

**Query and render (no intermediate storage):**

```typescript
const { connection } = useDuckDB();

// Build query
const query = new QueryBuilder("sales_table")
  .filter([{ columnName: "active", operator: "=", value: true }])
  .sort([{ columnName: "created_at", direction: "desc" }])
  .limit(100);

// vgplot renders directly from query
vgplot.plot(connection, query.sql());
```

**Insight-based analysis:**

```typescript
const insight = new Insight({
  name: "Sales by Region",
  baseTableId: salesTableId,
  metrics: [{ column: "amount", function: "sum", alias: "total" }],
  groupBy: ["region"],
  orderBy: [{ columnName: "total", direction: "desc" }],
});

// Generate SQL, vgplot renders directly
const sql = insight.toSQL(dataSourcesStore);
vgplot.plot(connection, sql);
```

**CSV Upload (persists source data):**

```typescript
const { dataFrame, fields, sourceSchema } = await csvToDataFrame(csvData, conn);

// Persist to IndexedDB
const dataFrameId = dataFramesStore.add(dataFrame);

// Create DataTable reference
dataSourcesStore.addDataTable(localSourceId, fileName, fileName, {
  fields,
  sourceSchema,
  dataFrameId,
});

// Load into DuckDB for queries
await loadSourceTable(dataFrame, conn);
```

### Query Translation

Insight generates SQL, vgplot executes directly:

```typescript
const insight = new Insight({
  baseTableId: "csv123",
  selectedFields: ["category_field_id", "amount_field_id"],
  metrics: [{ name: "total", columnName: "amount", aggregation: "sum" }],
  groupBy: ["category"],
  orderBy: [{ columnName: "total", direction: "desc" }],
  limit: 10,
});

// insight.toSQL() generates:
// SELECT category, SUM(amount) as total
// FROM csv_table
// GROUP BY category
// ORDER BY total DESC
// LIMIT 10

// vgplot executes directly - no intermediate storage
vgplot.plot(conn, insight.toSQL(dataSourcesStore));
```

**Join Support:**

```typescript
const insight = new Insight({
  baseTableId: "customers",
  joins: [
    {
      tableId: "orders",
      joinOn: { baseField: "email", joinedField: "customer_email" },
      joinType: "inner",
    },
  ],
  metrics: [{ name: "total_spent", columnName: "amount", aggregation: "sum" }],
});

// Generates JOIN SQL, vgplot renders directly
```
