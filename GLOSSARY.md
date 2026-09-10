# DashFrame glossary

Canonical product terms for UI copy, documentation, and code naming. See [PRODUCT.md](PRODUCT.md) for what the product is, and [DESIGN.md](DESIGN.md) for presentation and interaction rules.

## Terms

These are the canonical target terms. Model types live in `@dashframe/types`. New surfaces and new copy use this vocabulary. Where shipped copy still uses an older word, the entry says so: that word is debt, not an alternative spelling. Do not introduce it into new copy, and prefer the canonical term when you are already editing a surface that uses it.

### Data source

A connection to a file, database, or SaaS account.

Model: `DataSource`

### Table

A source table, or an insight's result used as a table.

Model: `DataTable`, `Insight`

### Insight

A saved query: source, joins, fields, metrics, filters, sort, and viewer controls. Returns a table.

Model: `Insight`

Shipped copy still says **question** — the insights page, dashboard detail, and data-source pickers are entry points, not an inventory. Do not use “query” as the name of an insight in user-facing copy; definitions and code may still describe an insight as a saved query.

### Field

A column of an insight's tables.

Model: `Field`

### Metric

A column aggregation — sum, count, avg. Either saved on a table for reuse, or defined inside one insight.

Model: `Metric` (table-owned), `InsightMetric` (insight-local)

### Filter

A row condition, phrased as “channel is not beta”.

Model: `InsightFilter`

### Viewer controls

The filters, sort, and limit a dashboard viewer may change.

Model: `InsightRuntimeDeclaration`

### Visualization

A chart of an insight's result, with encodings and appearance. An insight may have many.

Model: `Visualization`, `VisualizationEncoding`

Shipped copy still says **saved view**, in insight and dashboard delete confirmations.

### Dashboard

An arrangement of visualizations and text, with controls.

Model: `Dashboard`, `DashboardControl`

Shipped copy still says **report** — navigation, `lib/reports/`, and the MCP surface in `apps/server/src/mcp/` are entry points, not an inventory.

## Workbench

The authoring layout: a central work canvas with configuration panes on either side. “Workbench” names the layout, not a saved artifact or model type. Pane responsibilities are defined in [DESIGN.md](DESIGN.md#workbench).

## Grouping, pivots, and limits

Accepted behavioral targets. The model gaps below distinguish intended behavior from current support; presentation rules live in [DESIGN.md](DESIGN.md#workbench).

- **Date grouping:** group a date field by granularity (day, week, month, quarter, year) or date part (month of year, day of week, quarter of year). Today `Insight.selectedFields` holds IDs only; `DateTransform` lives on chart encodings.
- **Pivot:** spread a field's values across columns. Any number of fields may pivot, nested in selected-field order, with one column per value per metric. A pivot remains a dimension, not a metric. Insight-level pivots are not yet modeled.
- **Result limit:** maximum rows returned by a run. No saved result-limit property exists on `Insight`; `runtimeControls.limit` sets allowed bounds and `InsightRuntimeInput.limit` supplies a run's value.

Persisted visualization encodings use `VisualizationEncoding`; rendering uses the resolved `ChartEncoding`.
