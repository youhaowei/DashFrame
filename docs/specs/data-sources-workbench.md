# Data Sources Workbench

Spec for refreshing `/data-sources` so it behaves like a focused tool for inspecting and managing pipelines. This replaces the marketing-like hero with a utility-first workspace where users jump straight from source selection to insight + data previewing.

## Objectives

1. **Source-first navigation** – surfaces every CSV/Notion source in a compact list at the top so the user can quickly select a pipeline.
2. **Immediate context** – selecting a source reveals its metadata, associated insights, and a preview of the underlying records without visiting separate screens.
3. **Operational tone** – keep the page feeling like an internal console (subtle gradients, tight density, emphasis on tables/cards) rather than a marketing splash.
4. **Insight management** – allow quick review/creation of insights for connections that require them (Notion) and show which insights power downstream visuals.
5. **Data verification** – embed a preview table so the latest rows/columns are visible next to insight details.

## Non-Goals

- Rewriting storage logic or data-source primitives (keep Zustand store contracts intact).
- Building a full ETL monitor—limit to CSV uploads + Notion connections, no scheduling.
- Surfacing marketing copy or large hero art.

## Layout & Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Sources Rail (top, full width)                             │
│  ┌─ Source Pill ────────────────┐  ┌─ ...                   │
│  │ icon + name + stats          │  │                        │
│  └──────────────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Main Workbench                                              │
│ ┌───────────────┬─────────────────────────────────────────┐ │
│ │ Left Panel     │  Right Panel                            │ │
│ │  - Source meta │  ┌─ Insight Editor (optional) ────────┐ │ │
│ │  - Insights    │  │ - Visible when Notion insight picked│ │ │
│ │    (scrollable)│  │ - Inline controls + refresh         │ │ │
│ │               │  └──────────────────────────────────┘ │ │
│ │               │  ┌─ Data Preview (scrollable) ───────┐ │ │
│ │               │  │ - Collapsible when editor showing │ │ │
│ │               │  │ - First 50 rows                   │ │ │
│ │               │  └──────────────────────────────────┘ │ │
│ └───────────────┴─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Regions

| Region                | Purpose                                                                                                                                   | Interaction Notes                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sources Rail**      | Full-width horizontal pills sorted by created/updated time. Displays CSV vs Notion icon, file size/insight count, and status at a glance. | Selection drives the entire workbench; pills remain compact and keyboard navigable. Include inline actions for "Add"                                                  |
| **Left Panel**        | Dedicated column with source metadata card + insight list stacked vertically (scrollable independently).                                  | Keeps management context persistent while editing; metadata card surfaces rename/delete, insight list highlights current selection and uses inline actions.           |
| **Insight Editor**    | Appears in right column when a Notion insight is selected. Hosts insight-specific controls (fields, refresh, delete).                     | Should be collapsible/hidden for CSV sources or when no insight is selected. When open, it pushes preview downward but the preview can collapse to reclaim space.     |
| **Data Preview Pane** | Scrollable table preview limited to first 50 rows from the selected data frame.                                                           | Container supports collapse/expand when editor is visible; still shows empty states for missing data/insights. Sticky header + light borders preserve tool-like feel. |

## User Flows

### Flow A: Scan & Inspect CSV Source

1. Page loads, first source auto-selected (if none -> empty guidance).
2. User clicks another CSV card.
3. Sidebar updates with file metadata + actions.
4. Insight stack shows optional CSV insights (still allowed but secondary).
5. Preview automatically fetches DataFrame rows via `useDataFramesStore.get(dataFrameId)` and renders in table grid.

### Flow B: Manage Notion Connection & Insights

1. User selects Notion card; sidebar surfaces API key state + “Sync databases” button (reusing `NewDataSourcePanel` logic).
2. Insight stack lists all insights (Map entries) sorted by createdAt.
3. Selecting an insight updates preview to show data via `createDataFrameFromInsight` results (existing DataFrame per insight) and opens the inline editor above the preview for editing fields/refreshing.
4. “Add Insight” button opens inline drawer or modal (reuse `NewDataSourcePanel` Notion tab) to create new slices.
5. Once new insight saved, list refreshes and preview auto-focuses on it.

### Flow C: Empty Workspace

1. No sources: show centered card with “Upload CSV” and “Connect Notion” buttons.
2. Once first source added, auto-select it and collapse empty state.

## Data & State

- **Selected Source ID**: local `useState<UUID | null>` seeded to first entry of `dataSources`. Reset to null if source deleted.
- **Selected Insight ID**: scoped per source; when the user switches sources default to the first insight (if any) for Notion, or `null` for CSV uploads. This state determines which insight editor is visible and which preview dataset to load.
- **Preview Data**:
  - CSV: call `useDataFramesStore((s) => s.get(dataFrameId))`.
  - Notion: `insightId` references DataFrame; if missing, show CTA to refresh/import.
  - Preview table uses `DataGrid` styling but simplified to avoid nested tables; limit to 50 rows & show column tags. Preview container supports a `collapsed` boolean that reduces height when the user wants to focus on the insight editor.
- **Actions**:
  - Delete source -> confirm -> `remove(id)` then update selections.
  - Refresh insight -> call `queryDatabase` mutation, update DataFrame via existing store action.
  - Rename -> small inline form writing to relevant store field (CSV name, Notion connection name).

## Visual Treatment

- Stick to radial gradient from home page but as subtle top border; remove marketing copy.
- Use compact cards (rounded-xl, 14px text) to keep it tool-like.
- Insight stack uses accordion with badges showing property counts.
- Data preview uses fixed header table with sticky columns for readability.
- Favor sentence-case labels (avoid all caps) to match updated brand tone.

## API & Component Reuse

- Continue using `NewDataSourcePanel` for CSV upload + Notion connection, but integrate it via an “Add Source” dialog rather than inline large card.
- `DataGrid` component may be adapted for preview but ensure accessibility (table headers, pagination optional).
- Hooks: rely on `useDataSourcesStore`, `useDataFramesStore`, `useVisualizationsStore` (for reference) without introducing new global state.

## Edge Cases & States

| Scenario                                  | Behavior                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| No DataFrame for CSV (upload interrupted) | Sidebar flags status "Needs data" with CTA to re-upload. Preview shows skeleton with retry button. |
| Insight creation fails                    | Keep drawer open, show inline error from TRPC mutation.                                            |
| Large CSV (>100MB)                        | Show error inline on upload; suggest splitting file or reducing size.                              |
| API key missing (Notion)                  | Card shows "Disconnected" badge and disables insight list until reconnected.                       |

## Implementation Notes

1. Create dedicated `DataSourcesWorkbench` component under `apps/web/components/data-sources/`.
2. Update `/data-sources/page.tsx` to compose:
   - `<SourcesRail />` (top strip)
   - `<WorkbenchLeftColumn />` (details + insights)
   - `<WorkbenchRightColumn />` containing `<InsightEditor />` + `<DataPreview />`
3. Refactor existing `DataGrid` usage to only power “Structured Inventory” table that moves to bottom tabs.
4. Ensure keyboard navigation (arrow keys to change selected source, Enter to open actions).
5. Add tests (React Testing Library) for selection logic once the UI stabilizes.
6. Add a preview collapse toggle (chevron button) so users can maximize the insight editor when needed.

## Open Questions

1. Should deleting a source automatically delete its linked visualizations? (Currently yes via cascading store logic, but confirm UX messaging.)
2. Do we need pagination for data preview beyond first 50 rows?
3. Where should insight creation live (inline sheet vs existing panel)? Pending final UX decision.
