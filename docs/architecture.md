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
- **Helper text** - Write for users, not developers (e.g., "Stored locally in your browser" ✓, "localStorage key: dash-frame:api-key" ✗)

### Accessibility

- **Icon-only buttons** require `aria-label` attributes
- **Form inputs** need proper `<label>` elements or aria-labels
- **Loading states** must provide feedback (`aria-busy`, `aria-live` regions)
- **Keyboard navigation** - All interactive elements accessible via keyboard
- **Color contrast** - Follow WCAG AA standards (Tailwind's default palette generally compliant)

## Naming Notes

- Product and architectural references use the `DashFrame` name.
- Workspace packages and config utilities follow the kebab-case `@dash-frame/*` scope (e.g. `@dash-frame/dataframe`) to stay aligned with npm conventions.
