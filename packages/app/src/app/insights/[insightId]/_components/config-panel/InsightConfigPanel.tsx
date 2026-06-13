import {
  computeCombinedFields,
  computeFilterableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import {
  useDataTableMutations,
  useInsightMutations,
  useVisualizationMutations,
  useVisualizations,
} from "@dashframe/core";
import type {
  DataTable,
  Insight,
  InsightFilter,
  InsightMetric,
} from "@dashframe/types";
import { InputField } from "@dashframe/ui";
import { Panel } from "@wystack/ui";
import { useCallback, useMemo, useState } from "react";
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

export function InsightConfigPanel({
  insight,
  dataTable,
  allDataTables,
  name,
  onNameChange,
}: InsightConfigPanelProps) {
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

  // Mutations
  const { update: updateInsight } = useInsightMutations();
  const { updateField } = useDataTableMutations();
  const { updateEncoding, remove: removeVisualization } =
    useVisualizationMutations();

  // Get visualizations for this insight to check dependencies
  const { data: insightVisualizations = [] } = useVisualizations(insight.id);

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

  /**
   * Stable client-side ids for filters, used for SortableList keying and for
   * matching an in-flight edit back to its predicate on save.
   *
   * `_id` is sourced from the filter's persisted `id` (generated on add by
   * FilterEditDialog and preserved across persistence round-trips). This
   * survives a subscription firing mid-edit — a concurrent reorder no longer
   * shifts the id, so handleSaveFilter cannot misroute the save to the wrong
   * filter. Filters created via the API/agent path without an `id` fall back to
   * a content+index key; those aren't expected to be edited concurrently.
   */
  const filtersWithIds = useMemo(
    (): FilterWithId[] => withFilterIds(insight.filters),
    [insight.filters],
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
      try {
        await updateField(field.sourceTableId, field.id, { name: newName });
      } catch (error) {
        console.error("Failed to rename field:", error);
        alert("Failed to rename field. Please try again.");
      }
    },
    [updateField],
  );

  // --- Metric handlers ---
  const handleMetricsReorder = useCallback(
    (newOrder: InsightMetric[]) => {
      updateInsight(insight.id, { metrics: newOrder });
    },
    [insight.id, updateInsight],
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
    (metric: InsightMetric) => {
      const updated = [...(insight.metrics ?? []), metric];
      updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  const handleEditMetric = useCallback(
    (updatedMetric: InsightMetric) => {
      const updated = (insight.metrics ?? []).map((m) =>
        m.id === updatedMetric.id ? updatedMetric : m,
      );
      updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  // --- Filter handlers ---
  /** Strip client-only _id before persisting */
  const stripFilterIds = useCallback(
    (fs: FilterWithId[]): InsightFilter[] =>
      fs.map(({ _id: _discarded, ...rest }) => rest),
    [],
  );

  const handleFiltersReorder = useCallback(
    (reordered: FilterWithId[]) => {
      updateInsight(insight.id, { filters: stripFilterIds(reordered) });
    },
    [insight.id, stripFilterIds, updateInsight],
  );

  const handleRemoveFilter = useCallback(
    (filterId: string) => {
      const updated = filtersWithIds.filter((f) => f._id !== filterId);
      updateInsight(insight.id, { filters: stripFilterIds(updated) });
    },
    [insight.id, filtersWithIds, stripFilterIds, updateInsight],
  );

  const handleSaveFilter = useCallback(
    (saved: FilterWithId) => {
      const updated = applyFilterSave(filtersWithIds, saved);
      updateInsight(insight.id, { filters: stripFilterIds(updated) });
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
        await updateEncoding(vizId, newEncoding);
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
      updateEncoding,
    ],
  );

  const handleDeleteVisualization = useCallback(
    async (vizId: string) => {
      setProcessingVizId(vizId);
      try {
        await removeVisualization(vizId);
        // No need to update state - affectedVisualizations is computed reactively
      } catch (error) {
        console.error("Failed to delete visualization:", error);
        alert("Failed to delete visualization. Please try again.");
      } finally {
        setProcessingVizId(null);
      }
    },
    [removeVisualization],
  );

  const handleConfirmDelete = useCallback(() => {
    if (deleteDialog.itemType === "field") {
      const updated = (insight.selectedFields ?? []).filter(
        (id) => id !== deleteDialog.itemId,
      );
      updateInsight(insight.id, { selectedFields: updated });
    } else {
      const updated = (insight.metrics ?? []).filter(
        (m) => m.id !== deleteDialog.itemId,
      );
      updateInsight(insight.id, { metrics: updated });
    }
  }, [
    deleteDialog.itemType,
    deleteDialog.itemId,
    insight.id,
    insight.selectedFields,
    insight.metrics,
    updateInsight,
  ]);

  return (
    <Panel
      header={
        <div className="p-4">
          <InputField
            label="Name"
            value={name}
            onChange={onNameChange}
            placeholder="Insight name"
            className="text-lg font-semibold"
          />
        </div>
      }
    >
      <div className="space-y-0">
        {/* Fields Section */}
        <FieldsSection
          selectedFields={selectedFields}
          baseTableId={dataTable.id}
          onReorder={handleFieldsReorder}
          onRemove={handleRemoveField}
          onRenameClick={setFieldToRename}
          onAddClick={() => setIsFieldEditorOpen(true)}
        />

        {/* Metrics Section */}
        <MetricsSection
          metrics={visibleMetrics}
          onReorder={handleMetricsReorder}
          onRemove={handleRemoveMetric}
          onEditClick={setMetricToEdit}
          onAddClick={() => setIsMetricEditorOpen(true)}
        />

        {/* Filters Section */}
        <FiltersSection
          filters={filtersWithIds}
          combinedFields={combinedFields}
          onReorder={handleFiltersReorder}
          onRemove={handleRemoveFilter}
          onEditClick={setFilterToEdit}
          onAddClick={() => setFilterToEdit("new")}
        />
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
