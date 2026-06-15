# Editor Modals Audit — 2026-06-15

Feeds design tickets YW-233 (inline-edit popover primitive) and YW-150 (override-editing UI).

Scope: `packages/app/src` — every component that renders an edit form for a single list item, field, or node.

---

## Component Inventory

| component                        | file                                                                             | edits what                                                                                   | trigger                                                            | modal-or-inline today                                              | prop shape (key props)                                                                                                                                   | live-or-dead (routed?)                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `FieldEditorModal`               | `components/data-sources/FieldEditorModal.tsx`                                   | A single `Field` (name, type, sensitivity, isIdentifier)                                     | Edit button in `TableDetailPanel`                                  | Modal (`Dialog`)                                                   | `{ isOpen, field: Field\|null, onSave(id, updates), onClose }`                                                                                           | **DEAD** — only used inside `DataSourcesWorkbench`, which is exported from the barrel but never imported in any route |
| `MetricEditorModal`              | `components/data-sources/MetricEditorModal.tsx`                                  | Create a new `Metric` (aggregation type, field, name)                                        | "Add Metric" button in `TableDetailPanel`                          | Modal (`Dialog`)                                                   | `{ isOpen, tableId, availableFields, onSave(metric), onClose }`                                                                                          | **DEAD** — same: only used inside `DataSourcesWorkbench`, never in a routed page                                      |
| `TableDetailPanel`               | `components/data-sources/TableDetailPanel.tsx`                                   | Not itself a modal — the panel that triggers `FieldEditorModal`/`MetricEditorModal`          | Rendered inside `DataSourcesWorkbench`                             | Panel (not a modal)                                                | (coordinator, not an editor)                                                                                                                             | **DEAD** — only mounted in `DataSourcesWorkbench`                                                                     |
| `InsightFieldEditorModal`        | `app/insights/[insightId]/_components/config-panel/InsightFieldEditorModal.tsx`  | Add a field (dimension) to an insight — picker, not full edit                                | "Add field" button in `FieldsSection`                              | Modal (`Dialog`)                                                   | `{ isOpen, onOpenChange, availableFields: CombinedField[], baseTableId, onSelect(fieldId) }`                                                             | **LIVE** — used in `InsightConfigPanel`, routed via `/insights/$insightId`                                            |
| `InsightMetricEditorModal`       | `app/insights/[insightId]/_components/config-panel/InsightMetricEditorModal.tsx` | Create a new `InsightMetric` (aggregation, column, name)                                     | "Add metric" button in `MetricsSection`                            | Modal (`Dialog`)                                                   | `{ isOpen, onOpenChange, dataTable, onSave(metric) }`                                                                                                    | **LIVE** — used in `InsightConfigPanel`                                                                               |
| `MetricEditDialog`               | `app/insights/[insightId]/_components/config-panel/MetricEditDialog.tsx`         | Edit an existing `InsightMetric` (aggregation, column, name)                                 | Per-item edit click in `MetricsSection`                            | Modal (`Dialog`)                                                   | `{ metric: InsightMetric\|null, dataTable, onOpenChange, onSave(metric) }`                                                                               | **LIVE** — used in `InsightConfigPanel`                                                                               |
| `FieldRenameDialog`              | `app/insights/[insightId]/_components/config-panel/FieldRenameDialog.tsx`        | Rename a `CombinedField` display name (column name is read-only)                             | Per-item rename click in `FieldsSection`                           | Modal (`Dialog`)                                                   | `{ field: CombinedField\|null, tableName?, onOpenChange, onSave(field, newName) }`                                                                       | **LIVE** — used in `InsightConfigPanel`                                                                               |
| `FilterEditDialog`               | `app/insights/[insightId]/_components/config-panel/FilterEditDialog.tsx`         | Add or edit an `InsightFilter` (field, operator, value/range)                                | "Add filter" or per-item edit in `FiltersSection`                  | Modal (`Dialog`)                                                   | `{ filter: FilterWithId\|"new"\|null, combinedFields, onOpenChange, onSave(filter) }`                                                                    | **LIVE** — used in `InsightConfigPanel`                                                                               |
| `DeleteConfirmDialog`            | `app/insights/[insightId]/_components/config-panel/DeleteConfirmDialog.tsx`      | Confirm deletion of a field or metric; resolve viz dependencies                              | Delete button in `FieldsSection`/`MetricsSection`                  | Modal (`Dialog`)                                                   | `{ isOpen, itemName, itemType, affectedVisualizations, processingVizId, onClose, onRemoveFromVisualization, onDeleteVisualization, onDelete }`           | **LIVE** — used in `InsightConfigPanel`                                                                               |
| `ChartTypePickerModal`           | `components/visualizations/ChartTypePickerModal.tsx`                             | Select a chart type from AI suggestions (wraps `ChartTypePicker`)                            | "Add chart" button when visualizations already exist               | Modal (`Dialog`)                                                   | `{ isOpen, onClose, tableName, insight, columnAnalysis, rowCount, fieldMap, existingFields, onCreateChart, isLoading?, suggestionSeed?, onRegenerate? }` | **LIVE** — used in `InsightView`                                                                                      |
| `CreateVisualizationModal`       | `components/visualizations/CreateVisualizationModal.tsx`                         | Pick a data source / insight to create a new visualization from; then choose edit vs. derive | CTA buttons throughout app                                         | Modal (`Dialog`) wrapping `DataPickerModal` + inline action dialog | `{ isOpen, onClose }`                                                                                                                                    | **LIVE** — used in `VisualizationsSection`, `RecentVisualizationsSection`                                             |
| `JoinFlowModal`                  | `components/visualizations/JoinFlowModal.tsx`                                    | Pick a table or insight to join with current insight                                         | "Join" button in `DataSourcesSection`                              | Modal (wraps `DataPickerModal`)                                    | `{ insight, dataTable, isOpen, onOpenChange }`                                                                                                           | **LIVE** — used in `DataModelSection`                                                                                 |
| `DataPickerModal`                | `components/data-sources/DataPickerModal.tsx`                                    | Pick a table or insight (multi-use: creation, join)                                          | Used by `CreateVisualizationModal`, `JoinFlowModal`                | Modal (`Dialog`)                                                   | `{ isOpen, onClose, title, onInsightSelect?, onTableSelect?, showInsights?, excludeInsightIds?, excludeTableIds? }`                                      | **LIVE** — shared utility                                                                                             |
| Inline "Create Dashboard" dialog | `app/dashboards/page.tsx` (inline, not its own component)                        | Create a new dashboard (name input only)                                                     | "New Dashboard" button on list page                                | Modal (`Dialog` inline in page)                                    | local state: `isCreateOpen, newDashboardName`                                                                                                            | **LIVE** — route `/dashboards`                                                                                        |
| Inline "Add Widget" dialog       | `app/dashboards/[dashboardId]/_components/DashboardDetailContent.tsx` (inline)   | Add a visualization or markdown widget to a dashboard                                        | "Add Widget" button in dashboard detail                            | Modal (`Dialog` inline)                                            | local state: `isAddOpen, addType, selectedVizId`                                                                                                         | **LIVE** — route `/dashboards/$dashboardId`                                                                           |
| Inline "Delete Table" dialog     | `app/data-sources/[sourceId]/_components/DataSourcePageContent.tsx` (inline)     | Confirm deletion of a table                                                                  | Dropdown action on table header                                    | Modal (`Dialog` inline)                                            | local state: `deleteConfirmState: { isOpen, tableId, tableName }`                                                                                        | **LIVE** — route `/data-sources/$sourceId`                                                                            |
| Inline "Delete Table" dialog     | `components/data-sources/DataSourcesWorkbench.tsx` (inline)                      | Same as above, confirm table deletion                                                        | Dropdown action on `TableDetailPanel`                              | Modal (`Dialog` inline)                                            | local state: `deleteConfirmState`                                                                                                                        | **DEAD** — `DataSourcesWorkbench` never routed                                                                        |
| `ConfirmDialog`                  | `components/confirm-dialog.tsx`                                                  | Generic imperative confirmation (title, description, confirm/cancel)                         | Global store (`confirm-dialog-store`); mounted once at `RouteRoot` | Modal (`Dialog`)                                                   | controlled by store; no direct props                                                                                                                     | **LIVE** — global utility, rendered once in `routeRoot.tsx`                                                           |

---

## Consolidation Candidates

These are editors where a single inline-edit primitive — anchored to the trigger element, not a full-screen modal — could replace or dramatically simplify the implementation.

| #   | component                                                    | why it's a candidate                                                                                                                                                                  |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `FieldRenameDialog`                                          | Single text field (display name), read-only context row. Textbook inline-edit — one input, save/cancel, triggered from a list row.                                                    |
| 2   | `FieldEditorModal` (dead)                                    | Multi-field form but with a clear anchor (the field row in the table). Would become live (replacing its dead host) in the new inline-edit surface.                                    |
| 3   | Inline "Create Dashboard" dialog                             | Single name input. No complex logic. Should be an inline text input, not a modal.                                                                                                     |
| 4   | Inline "Delete Table" (both live and dead copies)            | Confirm-only, no form. The global `ConfirmDialog` already exists for exactly this; the inline duplicates should be replaced by it.                                                    |
| 5   | `MetricEditDialog`                                           | Name + aggregation + column select. Moderate complexity. Structure mirrors `InsightMetricEditorModal` closely.                                                                        |
| 6   | `InsightMetricEditorModal` (add) + `MetricEditDialog` (edit) | These two are near-identical (same fields, same formula preview, same aggregation options). Add vs. edit is a mode flag, not a different primitive. Strong consolidation opportunity. |
| 7   | `MetricEditorModal` (dead)                                   | Duplicate of the above pair in the dead workbench. Would collapse into the consolidated metric editor.                                                                                |

**Count: 7 consolidation candidates** (items 1–7 above). Items 4 and 7 collapse into existing utilities rather than needing a new primitive.

### Common shape across the core edit candidates (1, 2, 5, 6)

Observed across `FieldRenameDialog`, `FieldEditorModal`, `MetricEditDialog`, `InsightMetricEditorModal`:

```
anchor: ReactNode | HTMLElement ref      // the trigger row/button, used to position the popover
item: T                                  // the record being edited (Field | CombinedField | InsightMetric)
fields: FieldDef[]                       // the form fields to render (name, type, select, checkbox)
onSave: (updated: T) => void             // called with updated record on submit
onCancel: () => void                     // called on dismiss / Escape
isNew?: boolean                          // add vs. edit mode (drives title and save label)
```

Across all candidates the reset pattern is uniform: key-based remount (`key={item.id}`) rather than `useEffect`-to-setState.

---

## Outliers

| component                  | why it cannot consolidate                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FilterEditDialog`         | Multi-mode value input: scalar, between (two inputs), in (comma list). Operator drives which input variant appears. The compound branching logic is feature-specific and does not fit a generic field-list primitive. |
| `InsightFieldEditorModal`  | It is a **picker**, not an editor — it shows a searchable grouped list of available fields and fires `onSelect`. No form state beyond a search query. Different UX contract from an inline-edit.                      |
| `DeleteConfirmDialog`      | Deletion-specific UI: lists affected visualizations, offers per-viz "remove" vs. "delete" actions, and blocks the primary delete until all are resolved. This dependency-resolution flow has no generic counterpart.  |
| `ChartTypePickerModal`     | Picker with AI-suggested chart type cards and live previews. Large surface (`size="xl"`, `max-h-[60vh]`), regenerate button, isLoading skeleton. Pure selection UX, no form editing.                                  |
| `CreateVisualizationModal` | Two-step navigation flow (pick source → choose action). Delegates to `DataPickerModal`. Navigation side-effects (route push) are part of the component's contract. Not an item editor.                                |
| `JoinFlowModal`            | Same pattern as `CreateVisualizationModal` — selection/navigation, not editing. Thin wrapper around `DataPickerModal`.                                                                                                |
| `DataPickerModal`          | Shared modal shell for selection flows. Generic enough to stand alone as a utility; not an item editor.                                                                                                               |
| Inline "Add Widget" dialog | Widget-type picker + visualization select. Too specific to the dashboard composition flow to generalize.                                                                                                              |
| `ConfirmDialog` (global)   | Already a primitive. Intended to absorb the inline delete-confirm duplicates, not to be replaced.                                                                                                                     |

---

## Recommended Primitive API Sketch

Based on the observed common denominator across candidates 1, 2, 5, and 6 only — not a full design, purely what the code shows is shared:

```ts
interface InlineEditProps<T> {
  // Positioning
  anchor: React.RefObject<HTMLElement>; // trigger element to anchor the popover to

  // Data
  item: T | null; // null = closed; non-null = open (key-based reset)
  isNew?: boolean; // drives title and primary button label

  // Fields descriptor (drives form rendering)
  fields: {
    key: keyof T;
    label: string;
    type: "text" | "select" | "checkbox";
    options?: { value: string; label: string }[]; // for "select"
    autoFocus?: boolean;
    required?: boolean;
    validate?: (value: unknown) => string | null;
  }[];

  // Callbacks
  onSave: (updated: T) => void;
  onCancel: () => void;
}
```

Observed behaviors the primitive must handle:

- Controlled open/closed via `item !== null` (not a separate `isOpen` flag)
- Key-based form reset when `item` changes (not `useEffect`)
- Save disabled when required fields are empty or unchanged
- Escape key and backdrop click both call `onCancel`
- `autoFocus` on first text input

Not observed / left to the design owner: popover placement strategy, animation, max-width, mobile behavior, whether to support async `onSave` with loading state.
