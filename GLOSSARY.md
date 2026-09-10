# DashFrame glossary

Canonical product terms for UI copy, documentation, and code naming. See [PRODUCT.md](PRODUCT.md) for what the product is, and [DESIGN.md](DESIGN.md) for presentation and interaction rules.

## Terms

These are the canonical target terms. Model types live in `@dashframe/types`. New surfaces and new copy use this vocabulary; some shipped copy does not yet — see **Rename in progress** below.

| Term            | Meaning                                                                                         | Model                                                   |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Data source     | Connection to a file, database, or SaaS account                                                 | `DataSource`                                            |
| Table           | Source table or an insight's result used as a table                                             | `DataTable`, `Insight`                                  |
| Insight         | Saved query: source, joins, fields, metrics, filters, sort, viewer controls; returns a table    | `Insight`                                               |
| Field           | Column of an insight's tables                                                                   | `Field`                                                 |
| Metric          | Column aggregation — sum, count, avg. Saved on a table for reuse, or defined inside one insight | `Metric` (table-owned), `InsightMetric` (insight-local) |
| Filter          | Row condition, phrased as “channel is not beta”                                                 | `InsightFilter`                                         |
| Viewer controls | Filters, sort, and limit a dashboard viewer may change                                          | `InsightRuntimeDeclaration`                             |
| Visualization   | Chart of an insight's result, with encodings and appearance; many per insight                   | `Visualization`, `VisualizationEncoding`                |
| Dashboard       | Arrangement of visualizations and text, with controls                                           | `Dashboard`, `DashboardControl`                         |

## Rename in progress

The shipped UI still uses an older vocabulary for three terms. The canonical term is the target; the shipped term is debt, not an alternative spelling. Do not introduce the shipped term into new copy, and prefer the canonical term when you are already editing a surface that uses it.

The locations below are entry points, not an exhaustive inventory — the older terms appear across insight, dashboard, visualization, and MCP surfaces.

| Canonical     | Shipped today | Where                                                                                |
| ------------- | ------------- | ------------------------------------------------------------------------------------ |
| Insight       | question      | `packages/app/src/app/insights/page.tsx`, dashboard detail, data-source pickers      |
| Visualization | saved view    | insight and dashboard delete confirmations                                           |
| Dashboard     | report        | `packages/app/src/components/navigation.tsx`, `lib/reports/`, `apps/server/src/mcp/` |

Do not use “query” as the name of an insight in user-facing copy. Definitions and code may describe what an insight is — a saved query.

## Workbench

The authoring layout: a central work canvas with configuration panes on either side. “Workbench” names the layout, not a saved artifact or model type. Pane responsibilities are defined in [DESIGN.md](DESIGN.md#workbench).

## Grouping, pivots, and limits

Accepted behavioral targets. The model gaps below distinguish intended behavior from current support; presentation rules live in [DESIGN.md](DESIGN.md#workbench).

- **Date grouping:** group a date field by granularity (day, week, month, quarter, year) or date part (month of year, day of week, quarter of year). Today `Insight.selectedFields` holds IDs only; `DateTransform` lives on chart encodings.
- **Pivot:** spread a field's values across columns. Any number of fields may pivot, nested in selected-field order, with one column per value per metric. A pivot remains a dimension, not a metric. Insight-level pivots are not yet modeled.
- **Result limit:** maximum rows returned by a run. No saved result-limit property exists on `Insight`; `runtimeControls.limit` sets allowed bounds and `InsightRuntimeInput.limit` supplies a run's value.

Persisted visualization encodings use `VisualizationEncoding`; rendering uses the resolved `ChartEncoding`.
