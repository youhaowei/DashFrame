# DashFrame Architecture Overview

Inspired by the Data Engine Rebuild architecture [Notion](https://www.notion.so/youhaowei/Data-Engine-Rebuild-Architecture-Overview-25ed48ccaf5480549c5ffd0c60b5d5e2)

## Vision

DashFrame aims to become a flexible business intelligence surface focused on transforming structured data into expressive visual narratives. The MVP validates the core pipeline: CSV upload → DataFrame → Vega-Lite chart.

## Domain Model Snapshot

- **Table** – physical database table (future scope)
- **View** – saved SQL representation (future scope)
- **Model** – semantic layer modeling joins, dimensions, and measures (future scope)
- **Field** – user-defined column with UUID reference, optional formula, and semantic metadata
- **Metric** – aggregation definition (sum, avg, count, etc.) for quantitative analysis
- **Visualization** – declarative recipe for charts (data-free spec referencing a model)
- **Data Frame** – runtime tabular result (columns + rows) injected into visualization rendering
- **Document** – arrangement of visualizations in dashboards, canvases, or reports (future scope)

Current MVP focuses on producing a `DataFrame` from CSV/Notion sources and rendering charts using Vega-Lite.

## Tech Stack (Current MVP)

- **Next.js (App Router)** for the builder UI
- **Tailwind CSS v4** for styling
- **Papaparse** for CSV parsing
- **Vega-Lite + Vega Embed** for chart rendering (dynamic client component)
- **Convex** for backend data persistence and real-time sync
- **Zustand** for client-side DataFrame caching only
- **tRPC** for external API calls (Notion integration)

## System Flow (MVP)

```
CSV Upload → DataFrame (columns + rows) → toVegaLite() → Vega-Lite Chart
```

The upload form parses CSV into a typed `DataFrame`, stored client-side. `buildVegaLiteSpec` produces a Vega-Lite spec while `VegaChart` embeds it, feeding table rows as inline values.

## Convex Backend

**Location:** `/convex` (at repo root, separate from frontend apps)

**Tables:**
- `dataSources` - Data connections (local, notion, postgresql)
- `dataTables` - Tables within data sources
- `fields` - Columns in data tables
- `metrics` - Aggregations on data tables
- `insights` - User-defined queries/transformations
- `insightMetrics` - Metrics within insights
- `visualizations` - Saved Vega-Lite specs

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
- **`Visualization`** - Vega-Lite spec referencing an insight's DataFrame

**Client-side only:**

- **`DataFrame`** - Runtime tabular data (cached in localStorage)

### State Split: Convex vs Local

| Data | Location | Reason |
|------|----------|--------|
| DataSources | Convex | User-owned, needs persistence |
| DataTables | Convex | User-owned, needs persistence |
| Fields/Metrics | Convex | User-owned, needs persistence |
| Insights | Convex | User-owned, needs persistence |
| Visualizations | Convex | User-owned, needs persistence |
| DataFrames | localStorage | Large cached data, client-side only |
| Active entity | URL params | Shareable, browser history |
| UI state | React useState | Ephemeral, component-local |

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

### Stores After Migration

| Store | Status | Purpose |
|-------|--------|---------|
| `dataframes-store.ts` | **Active** | Large DataFrame cache (localStorage) |
| `data-sources-store.ts` | Legacy | Replaced by Convex queries |
| `insights-store.ts` | Legacy | Replaced by Convex queries |
| `visualizations-store.ts` | Legacy | Replaced by Convex queries |

### Key Design Decisions

- **Server-first persistence** - Convex eliminates SSR hydration mismatches
- **Route-based navigation** - Active entity from URL, not store state
- **Schema separation** - sourceSchema (discovered) vs fields (user-defined)
- **UUID-based field references** - Formulas use UUIDs, enabling renames
- **Sample-first loading** - 100-row preview for instant UX
- **Semantic type preservation** - Source types enable smart features
- **Rule-based suggestions** - Client-side heuristics (no AI/GPT)

### Data Flows

**Local (CSV Upload)**:

```
Upload → Local DataSource
      → DataTable (file + loaded data)
      → DataFrame
      → Visualization
```

**Notion (Cached)**:

```
Phase 1: Discovery
  Connect → Notion DataSource
         → Fetch schema for all databases
         → Create DataTable (sourceSchema + auto-generated fields)
         → No data cached yet

Phase 2: Sample (Instant Preview)
  User selects database
         → Fetch first 100 rows
         → Create sample DataFrame (isSample: true)
         → Show in visualization builder

Phase 3: Full Sync (On Demand)
  User clicks "Sync Full Dataset"
         → Fetch all rows for current fields
         → Create complete DataFrame
         → Update visualizations
```

**PostgreSQL (Remote - Future)**:

```
Connect → PostgreSQL DataSource
       → DataTable (table metadata, no cache)
       → Query Insight (SQL)
       → DataFrame (on-demand)
       → Visualization
```

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
  dashframe:dataframes  (cached DataFrame results + metadata)
```

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
