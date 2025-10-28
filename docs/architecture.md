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
- **Tailwind CSS + shadcn/Radix** for styling and accessible components
- **Papaparse** for CSV parsing
- **Vega-Lite + Vega Embed** for chart rendering (dynamic client component)
- **localStorage** persistence for DataFrame and axis selections
- **TanStack Store/Form** for state and form handling

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
