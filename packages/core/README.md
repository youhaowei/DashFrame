# @dashframe/core

Pure types and repository interfaces for DashFrame. This package has **zero runtime dependencies**.

## Installation

```bash
pnpm add @dashframe/core
```

## Usage

```typescript
import type { UUID, Field, Metric, DataSource, Insight } from "@dashframe/core";
```

## Package Structure

```
src/
  types/           # Pure data types
    uuid.ts        # UUID type alias
    column.ts      # ColumnType, TableColumn, DataFrameColumn
    field.ts       # Field, SourceSchema
    metric.ts      # Metric, AggregationType, InsightMetric
    dataframe.ts   # DataFrameRow, DataFrameData
    data-table-info.ts  # DataTableField, DataTableInfo

  repositories/    # Repository interfaces (contracts for persistence)
    data-sources.ts    # DataSource, UseDataSources
    data-tables.ts     # DataTable, UseDataTables
    insights.ts        # Insight, UseInsights
    visualizations.ts  # Visualization, UseVisualizations
    dashboards.ts      # Dashboard, UseDashboards
```

## Core Types

### UUID

Type alias for string UUIDs used as entity identifiers.

### Column Types

- `ColumnType` - Data types: `"string" | "number" | "boolean" | "date" | "datetime" | "unknown"`
- `TableColumn` - Column metadata with name, type, nullable flag
- `DataFrameColumn` - Column with data array

### Field & Metric

- `Field` - User-defined column with UUID reference, optional formula
- `Metric` - Aggregation definition (sum, avg, count, min, max, count_distinct)
- `InsightMetric` - Metric instance within an Insight

### DataFrame Types

- `DataFrameRow` - Single row as key-value record
- `DataFrameData` - Collection of rows with optional column metadata

## Data Model Architecture

### DataTable Schema Layers

DataTables separate **discovered schema** from **user-defined analytical layer**:

| Layer             | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Source Schema** | Discovered columns from source (Notion properties, CSV headers) with original semantic types |
| **Fields**        | User-facing columns with UUIDs, can be renamed/hidden/calculated                             |
| **Metrics**       | Aggregation definitions (sum, avg, count) referenced by UUID                                 |

**DataTable Lifecycle:**

1. **Discovered** - Schema fetched, fields auto-generated, no data cached
2. **Sample Loaded** - First 100 rows cached for instant preview
3. **Fully Synced** - Complete dataset cached, ready for analysis

### UUID-Based References

Formulas reference fields/metrics by UUID, not by name:

- Users can rename anything without breaking formulas
- Avoids "stable name ID" pattern complexity
- Fields reference source columns via `basedOn` array

### Semantic Intelligence

Source columns preserve original types (Notion's status, relation, email). Fields look up source types to enable:

- Filtering email/URL fields from visualizations
- Detecting relation fields for join suggestions
- Smart visualization recommendations

### Smart Visualization Suggestions

Rule-based heuristics (no AI/GPT - instant, free, privacy-preserving):

| Pattern               | Suggested Chart   |
| --------------------- | ----------------- |
| Categorical + Count   | Bar chart         |
| Two numeric fields    | Scatter plot      |
| Date + Numeric        | Time series line  |
| Date + Count          | Activity timeline |
| Categorical + Numeric | Aggregated bar    |

**Field Scoring:** Prefer 2-50 distinct values, penalize high nulls, prioritize descriptive names, avoid system fields.

### Join Suggestions

Notion `relation` fields enable automatic join detection:

- **High confidence** - Detected from relation metadata
- **Medium confidence** - Name-based matching (field "Project" → table "Projects")

## Repository Interfaces

Repository interfaces define contracts for persistence. Implementations:

- `@dashframe/core-dexie` - Browser persistence with Dexie/IndexedDB (default)

### Pattern

```typescript
// Query hook type
type UseDataSources = () => UseDataSourcesResult;

// Mutation hook type
type UseDataSourceMutations = () => DataSourceMutations;

// Usage (implementation from core-dexie)
const { data, isLoading } = useDataSources();
const { addLocal, remove } = useDataSourceMutations();
```

### Available Repositories

| Entity         | Query Hook          | Mutation Hook               |
| -------------- | ------------------- | --------------------------- |
| DataSources    | `UseDataSources`    | `UseDataSourceMutations`    |
| DataTables     | `UseDataTables`     | `UseDataTableMutations`     |
| Insights       | `UseInsights`       | `UseInsightMutations`       |
| Visualizations | `UseVisualizations` | `UseVisualizationMutations` |
| Dashboards     | `UseDashboards`     | `UseDashboardMutations`     |

## Design Principles

1. **Zero dependencies** - Pure TypeScript types only
2. **Contract-first** - Repository interfaces define the API, implementations can vary
3. **UUID-based references** - All entities use UUID for stable references
4. **Immutable patterns** - Types designed for immutable state management
