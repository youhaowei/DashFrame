import {
  computeCombinedFields,
  computeFilterableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import { reorderVisibleMetrics } from "@/lib/insights/reorder-visible-metrics";
import { api } from "@/wystack/api";
import type {
  Command,
  DataTable,
  Insight,
  InsightFilter,
  InsightMetric,
  InsightRuntimeDeclaration,
  InsightSort,
  UUID,
} from "@dashframe/types";
import {
  buildInsightUpdateCommands,
  buildVisualizationUpdateCommands,
  cmd,
} from "@dashframe/types";
import { InputField } from "@dashframe/ui";
import { useMutation, useQuery } from "@wystack/client";
import { Badge, Panel, cn } from "@wystack/ui-react";
import {
  ArrowUpDown,
  Columns3,
  ListFilter,
  Sigma,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { DataModelSection } from "../sections/DataModelSection";
import {
  DeleteConfirmDialog,
  findVisualizationsUsingField,
  findVisualizationsUsingMetric,
  removeFromEncoding,
  type DeleteItemType,
} from "./DeleteConfirmDialog";
import { FieldRenameDialog } from "./FieldRenameDialog";
import { FieldsSection } from "./FieldsSection";
import { applyFilterSave, withFilterIds } from "./filter-id";
import { FilterEditDialog } from "./FilterEditDialog";
import { FiltersSection, type FilterWithId } from "./FiltersSection";
import { InsightFieldEditorModal } from "./InsightFieldEditorModal";
import { InsightMetricEditorModal } from "./InsightMetricEditorModal";
import { MetricEditDialog } from "./MetricEditDialog";
import { MetricsSection } from "./MetricsSection";
import { pruneRuntimeControls } from "./runtime-controls";
import { RuntimeControlsSection } from "./RuntimeControlsSection";
import { SortSection } from "./SortSection";

interface InsightConfigPanelProps {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  name: string;
  onNameChange: (name: string) => void;
}

/**
 * InsightConfigPanel - Left panel for configuring insight fields and metrics
 *
 * Features:
 * - Editable insight name in header
 * - Grouped sections for Fields (dimensions) and Metrics (aggregations)
 * - Drag-and-drop reordering via @dnd-kit
 * - Add/edit/remove functionality via dialog modals
 */
/** State for the delete confirmation dialog (minimal state, affected visualizations computed reactively) */
interface DeleteDialogState {
  isOpen: boolean;
  itemId: string;
  itemName: string;
  itemType: DeleteItemType;
}

const initialDeleteDialogState: DeleteDialogState = {
  isOpen: false,
  itemId: "",
  itemName: "",
  itemType: "field",
};

export async function removeFilterThroughCommands(
  commit: (input: { commands: Command[] }) => Promise<unknown>,
  insight: Insight,
  filterId: string,
): Promise<void> {
  const filters = withFilterIds(insight.filters)
    .filter((filter) => filter._id !== filterId)
    .map(({ _id: _discarded, ...filter }) => filter);
  await commit({
    commands: [cmd("SetInsightFilter", { id: insight.id, filters })],
  });
}

type ConfigSection =
  | "model"
  | "fields"
  | "metrics"
  | "filters"
  | "sort"
  | "runtime";

interface ConfigSectionButtonProps {
  active: boolean;
  count: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

function ConfigSectionButton({
  active,
  count,
  icon,
  label,
  onClick,
}: ConfigSectionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 min-w-0 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
        "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
        active
          ? "bg-neutral-bg-emphasis text-neutral-fg shadow-sm"
          : "text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg",
      )}
      aria-pressed={active}
      title={label}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <Badge
        variant="soft"
        className="h-4 min-w-4 px-1 text-[10px] leading-none tabular-nums"
      >
        {count}
      </Badge>
    </button>
  );
}

export function InsightConfigPanel({
  insight,
  dataTable,
  allDataTables,
  name,
  onNameChange,
}: InsightConfigPanelProps) {
  const [activeSection, setActiveSection] = useState<ConfigSection>("model");
  // Modal states
  const [isFieldEditorOpen, setIsFieldEditorOpen] = useState(false);
  const [isMetricEditorOpen, setIsMetricEditorOpen] = useState(false);
  const [fieldToRename, setFieldToRename] = useState<CombinedField | null>(
    null,
  );
  const [metricToEdit, setMetricToEdit] = useState<InsightMetric | null>(null);
  /** null = closed; FilterWithId = edit; "new" = add */
  const [filterToEdit, setFilterToEdit] = useState<FilterWithId | "new" | null>(
    null,
  );
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(
    initialDeleteDialogState,
  );
  const [processingVizId, setProcessingVizId] = useState<string | null>(null);

  // Mutations — every artifact write goes through commitBatch (one batch per edit).
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);
  const updateInsight = useCallback(
    async (
      id: Insight["id"],
      updates: Partial<Omit<Insight, "id" | "createdAt">>,
    ): Promise<void> => {
      const commands = buildInsightUpdateCommands(id, insight, updates);
      if (commands.length === 0) return;
      await commitBatch({ commands });
    },
    [commitBatch, insight],
  );
  const updateVisualization = useCallback(
    async (
      id: string,
      updates: Parameters<typeof buildVisualizationUpdateCommands>[1],
    ): Promise<void> => {
      const commands = buildVisualizationUpdateCommands(id, updates);
      if (commands.length === 0) return;
      await commitBatch({ commands });
    },
    [commitBatch],
  );
  const removeVisualizationMutation = useCallback(
    ({ id }: { id: UUID }) =>
      commitBatch({ commands: [cmd("DeleteNode", { id })] }),
    [commitBatch],
  );
  // Get visualizations for this insight to check dependencies
  const { data: insightVisualizations = [] } = useQuery(
    api.listVisualizations,
    { args: { insightId: insight.id } },
  );

  // Compute affected visualizations reactively based on current visualization state
  // This avoids race conditions where stale state was stored in the dialog
  const affectedVisualizations = useMemo(() => {
    if (!deleteDialog.isOpen) return [];
    return deleteDialog.itemType === "field"
      ? findVisualizationsUsingField(deleteDialog.itemId, insightVisualizations)
      : findVisualizationsUsingMetric(
          deleteDialog.itemId,
          insightVisualizations,
        );
  }, [
    deleteDialog.isOpen,
    deleteDialog.itemType,
    deleteDialog.itemId,
    insightVisualizations,
  ]);

  // Compute combined fields from base + joined tables
  const { fields: combinedFields } = useMemo(
    () => computeCombinedFields(dataTable, insight.joins, allDataTables),
    [dataTable, insight.joins, allDataTables],
  );

  // Fields that can actually back a filter predicate — excludes dropped right
  // join-keys and ambiguous duplicate column names that the SQL builder cannot
  // resolve. Offered in the FilterEditDialog picker so a saved filter always
  // produces a working predicate. (FiltersSection still receives the full
  // combinedFields, so an existing filter on an excluded field renders by name
  // rather than as a stale reference.)
  const filterableFields = useMemo(
    () => computeFilterableFields(combinedFields, insight.joins),
    [combinedFields, insight.joins],
  );

  // Get selected fields in order (preserving insight.selectedFields order)
  const selectedFields = useMemo(() => {
    const fieldMap = new Map(combinedFields.map((f) => [f.id, f]));
    return (insight.selectedFields ?? [])
      .map((id) => fieldMap.get(id))
      .filter((f): f is CombinedField => f !== undefined);
  }, [combinedFields, insight.selectedFields]);

  // Get available fields (not yet selected)
  const availableFields = useMemo(() => {
    const selectedIds = new Set(insight.selectedFields ?? []);
    return combinedFields.filter((f) => !selectedIds.has(f.id));
  }, [combinedFields, insight.selectedFields]);

  // Get visible metrics (exclude internal ones)
  const visibleMetrics = useMemo(
    () => (insight.metrics ?? []).filter((m) => !m.name.startsWith("_")),
    [insight.metrics],
  );
  const runtimeResultFields = useMemo(
    () => [
      ...selectedFields.map((field) => ({
        id: field.id as UUID,
        label: field.displayName,
      })),
      ...visibleMetrics.map((metric) => ({
        id: metric.id,
        label: metric.name,
      })),
    ],
    [selectedFields, visibleMetrics],
  );

  const handleRuntimeControlsChange = useCallback(
    (runtimeControls: InsightRuntimeDeclaration | undefined) => {
      const commands = runtimeControls
        ? buildInsightUpdateCommands(insight.id, insight, { runtimeControls })
        : [
            cmd("SetInsightRuntimeControls", {
              id: insight.id,
              runtimeControls: undefined,
            }),
          ];
      return commitBatch({ commands }).then(() => undefined);
    },
    [commitBatch, insight],
  );

  /**
   * Stable client-side ids for filters, used for SortableList keying and for
   * matching an in-flight edit back to its predicate on save.
   *
   * `_id` is sourced from the filter's persisted `id` (generated on add by
   * FilterEditDialog and the API write boundary, then preserved across
   * persistence round-trips). This survives a subscription firing mid-edit — a
   * concurrent reorder no longer shifts the id, so handleSaveFilter cannot
   * misroute the save to the wrong filter.
   */
  const filtersWithIds = useMemo(
    (): FilterWithId[] => withFilterIds(insight.filters),
    [insight.filters],
  );

  const sorts = insight.sorts ?? [];

  const handleSortsChange = useCallback(
    (nextSorts: InsightSort[]) => {
      updateInsight(insight.id, { sorts: nextSorts });
    },
    [insight.id, updateInsight],
  );

  // --- Field handlers ---
  const handleFieldsReorder = useCallback(
    (newOrder: string[]) => {
      updateInsight(insight.id, { selectedFields: newOrder });
    },
    [insight.id, updateInsight],
  );

  const handleRemoveField = useCallback(
    (fieldId: string) => {
      // Find the field to get its name
      const field = combinedFields.find((f) => f.id === fieldId);
      if (!field) return;

      // Open delete confirmation dialog (affected visualizations computed reactively)
      setDeleteDialog({
        isOpen: true,
        itemId: fieldId,
        itemName: field.displayName,
        itemType: "field",
      });
    },
    [combinedFields],
  );

  const handleAddField = useCallback(
    (fieldId: string) => {
      const updated = [...(insight.selectedFields ?? []), fieldId];
      updateInsight(insight.id, { selectedFields: updated });
    },
    [insight.id, insight.selectedFields, updateInsight],
  );

  const handleRenameField = useCallback(
    async (field: CombinedField, newName: string) => {
      // Update the display name in the source DataTable
      // This only changes the user-facing name, not the underlying columnName
      await commitBatch({
        commands: [
          cmd("UpdateField", {
            nodeId: field.sourceTableId,
            fieldId: field.id,
            updates: { name: newName },
          }),
        ],
      });
    },
    [commitBatch],
  );

  // --- Metric handlers ---
  const handleMetricsReorder = useCallback(
    (newOrder: InsightMetric[]) => {
      updateInsight(insight.id, {
        metrics: reorderVisibleMetrics(insight.metrics ?? [], newOrder),
      });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  const handleRemoveMetric = useCallback(
    (metricId: string) => {
      // Find the metric to get its name
      const metric = (insight.metrics ?? []).find((m) => m.id === metricId);
      if (!metric) return;

      // Open delete confirmation dialog (affected visualizations computed reactively)
      setDeleteDialog({
        isOpen: true,
        itemId: metricId,
        itemName: metric.name,
        itemType: "metric",
      });
    },
    [insight.metrics],
  );

  const handleAddMetric = useCallback(
    async (metric: InsightMetric) => {
      const updated = [...(insight.metrics ?? []), metric];
      await updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  const handleEditMetric = useCallback(
    async (updatedMetric: InsightMetric) => {
      const updated = (insight.metrics ?? []).map((m) =>
        m.id === updatedMetric.id ? updatedMetric : m,
      );
      await updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  // --- Filter handlers ---
  /** Strip client-only _id before persisting */
  const stripFilterIds = useCallback(
    (fs: FilterWithId[]): InsightFilter[] =>
      fs.map(
        ({
          _id: _discardedId,
          _saveIntent: _discardedIntent,
          _legacyFallback: _discardedFallback,
          ...rest
        }) => rest,
      ),
    [],
  );

  const handleFiltersReorder = useCallback(
    (reordered: FilterWithId[]) => {
      void updateInsight(insight.id, { filters: stripFilterIds(reordered) });
    },
    [insight.id, stripFilterIds, updateInsight],
  );

  const handleRemoveFilter = useCallback(
    (filterId: string) => {
      void removeFilterThroughCommands(commitBatch, insight, filterId);
    },
    [commitBatch, insight],
  );

  const handleSaveFilter = useCallback(
    async (saved: FilterWithId) => {
      const updated = applyFilterSave(filtersWithIds, saved);
      await updateInsight(insight.id, { filters: stripFilterIds(updated) });
    },
    [insight.id, filtersWithIds, stripFilterIds, updateInsight],
  );

  // --- Delete dialog handlers ---
  const handleCloseDeleteDialog = useCallback(() => {
    setDeleteDialog(initialDeleteDialogState);
    setProcessingVizId(null);
  }, []);

  const handleRemoveFromVisualization = useCallback(
    async (vizId: string) => {
      const viz = insightVisualizations.find((v) => v.id === vizId);
      if (!viz) return;

      setProcessingVizId(vizId);
      try {
        // Remove the item from the visualization's encoding
        const newEncoding = removeFromEncoding(
          viz.encoding,
          deleteDialog.itemId,
          deleteDialog.itemType,
        );
        await updateVisualization(vizId, { encoding: newEncoding });
        // No need to update state - affectedVisualizations is computed reactively
      } catch (error) {
        console.error("Failed to remove from visualization:", error);
        alert("Failed to update visualization. Please try again.");
      } finally {
        setProcessingVizId(null);
      }
    },
    [
      insightVisualizations,
      deleteDialog.itemId,
      deleteDialog.itemType,
      updateVisualization,
    ],
  );

  const handleDeleteVisualization = useCallback(
    async (vizId: string) => {
      setProcessingVizId(vizId);
      try {
        await removeVisualizationMutation({ id: vizId });
        // No need to update state - affectedVisualizations is computed reactively
      } catch (error) {
        console.error("Failed to delete visualization:", error);
        alert("Failed to delete visualization. Please try again.");
      } finally {
        setProcessingVizId(null);
      }
    },
    [removeVisualizationMutation],
  );

  const handleConfirmDelete = useCallback(() => {
    if (deleteDialog.itemType === "field") {
      const updated = (insight.selectedFields ?? []).filter(
        (id) => id !== deleteDialog.itemId,
      );
      updateInsight(insight.id, {
        selectedFields: updated,
        runtimeControls: pruneRuntimeControls(
          insight.runtimeControls,
          insight.filters ?? [],
          [...updated, ...(insight.metrics ?? []).map((metric) => metric.id)],
        ),
      });
    } else {
      const updated = (insight.metrics ?? []).filter(
        (m) => m.id !== deleteDialog.itemId,
      );
      updateInsight(insight.id, {
        metrics: updated,
        runtimeControls: pruneRuntimeControls(
          insight.runtimeControls,
          insight.filters ?? [],
          [
            ...(insight.selectedFields ?? []),
            ...updated.map((metric) => metric.id),
          ],
        ),
      });
    }
  }, [
    deleteDialog.itemType,
    deleteDialog.itemId,
    insight.id,
    insight.selectedFields,
    insight.metrics,
    insight.filters,
    insight.runtimeControls,
    updateInsight,
  ]);

  return (
    <Panel
      header={
        <div>
          <div className="p-4 pb-3">
            <InputField
              label="Name"
              value={name}
              onChange={onNameChange}
              placeholder="Insight name"
              className="text-lg font-semibold"
            />
          </div>
          <div
            className="grid grid-cols-2 gap-1 px-2 pb-2"
            aria-label="Data model sections"
          >
            <ConfigSectionButton
              active={activeSection === "model"}
              count={(insight.joins?.length ?? 0) + 1}
              icon={<Workflow className="h-3.5 w-3.5" />}
              label="Model"
              onClick={() => setActiveSection("model")}
            />
            <ConfigSectionButton
              active={activeSection === "fields"}
              count={selectedFields.length}
              icon={<Columns3 className="h-3.5 w-3.5" />}
              label="Fields"
              onClick={() => setActiveSection("fields")}
            />
            <ConfigSectionButton
              active={activeSection === "metrics"}
              count={visibleMetrics.length}
              icon={<Sigma className="h-3.5 w-3.5" />}
              label="Metrics"
              onClick={() => setActiveSection("metrics")}
            />
            <ConfigSectionButton
              active={activeSection === "filters"}
              count={filtersWithIds.length}
              icon={<ListFilter className="h-3.5 w-3.5" />}
              label="Filters"
              onClick={() => setActiveSection("filters")}
            />
            <ConfigSectionButton
              active={activeSection === "sort"}
              count={sorts.length}
              icon={<ArrowUpDown className="h-3.5 w-3.5" />}
              label="Sort"
              onClick={() => setActiveSection("sort")}
            />
            <ConfigSectionButton
              active={activeSection === "runtime"}
              count={
                (insight.runtimeControls?.filters?.length ?? 0) +
                (insight.runtimeControls?.sort ? 1 : 0) +
                (insight.runtimeControls?.limit ? 1 : 0)
              }
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              label="Runtime"
              onClick={() => setActiveSection("runtime")}
            />
          </div>
        </div>
      }
    >
      <div>
        {activeSection === "model" && (
          <div className="p-4">
            <DataModelSection
              insight={insight}
              dataTable={dataTable}
              allDataTables={allDataTables}
              combinedFieldCount={combinedFields.length}
              compact
            />
          </div>
        )}
        {activeSection === "fields" && (
          <FieldsSection
            selectedFields={selectedFields}
            baseTableId={dataTable.id}
            onReorder={handleFieldsReorder}
            onRemove={handleRemoveField}
            onRenameClick={setFieldToRename}
            onAddClick={() => setIsFieldEditorOpen(true)}
            embedded
          />
        )}
        {activeSection === "metrics" && (
          <MetricsSection
            metrics={visibleMetrics}
            onReorder={handleMetricsReorder}
            onRemove={handleRemoveMetric}
            onEditClick={setMetricToEdit}
            onAddClick={() => setIsMetricEditorOpen(true)}
            embedded
          />
        )}
        {activeSection === "filters" && (
          <FiltersSection
            filters={filtersWithIds}
            combinedFields={combinedFields}
            onReorder={handleFiltersReorder}
            onRemove={handleRemoveFilter}
            onEditClick={setFilterToEdit}
            onAddClick={() => setFilterToEdit("new")}
            embedded
          />
        )}
        {activeSection === "sort" && (
          <SortSection
            sorts={sorts}
            fields={selectedFields}
            metrics={visibleMetrics}
            onChange={handleSortsChange}
          />
        )}
        {activeSection === "runtime" && (
          <RuntimeControlsSection
            declaration={insight.runtimeControls}
            filters={insight.filters ?? []}
            resultFields={runtimeResultFields}
            onChange={handleRuntimeControlsChange}
          />
        )}
      </div>

      <InsightFieldEditorModal
        isOpen={isFieldEditorOpen}
        onOpenChange={setIsFieldEditorOpen}
        availableFields={availableFields}
        baseTableId={dataTable.id}
        onSelect={handleAddField}
      />
      <InsightMetricEditorModal
        isOpen={isMetricEditorOpen}
        onOpenChange={setIsMetricEditorOpen}
        dataTable={dataTable}
        onSave={handleAddMetric}
      />
      <FieldRenameDialog
        field={fieldToRename}
        tableName={
          fieldToRename
            ? allDataTables.find((t) => t.id === fieldToRename.sourceTableId)
                ?.name
            : undefined
        }
        onOpenChange={(open) => !open && setFieldToRename(null)}
        onSave={handleRenameField}
      />
      <MetricEditDialog
        metric={metricToEdit}
        dataTable={dataTable}
        onOpenChange={(open) => !open && setMetricToEdit(null)}
        onSave={handleEditMetric}
      />
      <FilterEditDialog
        filter={filterToEdit}
        combinedFields={filterableFields}
        onOpenChange={(open) => !open && setFilterToEdit(null)}
        onSave={handleSaveFilter}
      />
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        itemName={deleteDialog.itemName}
        itemType={deleteDialog.itemType}
        affectedVisualizations={affectedVisualizations}
        processingVizId={processingVizId}
        onClose={handleCloseDeleteDialog}
        onRemoveFromVisualization={handleRemoveFromVisualization}
        onDeleteVisualization={handleDeleteVisualization}
        onDelete={handleConfirmDelete}
      />
    </Panel>
  );
}
