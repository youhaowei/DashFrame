import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import {
  computeCombinedFields,
  computeFilterableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import { reorderVisibleMetrics } from "@/lib/insights/reorder-visible-metrics";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { api } from "@dashframe/convex-backend/api";
import type {
  Command,
  DataTable,
  Insight,
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
import {
  OverlayScrollArea,
  WorkbenchJumpBar,
  WorkbenchPaneHeader,
  WorkbenchPaneSection,
  useWorkbenchPaneSections,
} from "@dashframe/ui";

import {
  ArrowUpDown,
  Columns3,
  Eye,
  ListFilter,
  Sigma,
  Table2,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { DataModelSection } from "../sections/DataModelSection";
import {
  DeleteConfirmDialog,
  findVisualizationsUsingField,
  findVisualizationsUsingMetric,
  type UsageStatus,
  removeFromEncoding,
  type DeleteItemType,
} from "./DeleteConfirmDialog";
import { FieldsSection } from "./FieldsSection";
import {
  applyFilterSave,
  stripFilterClientMetadata,
  withFilterIds,
} from "./filter-id";
import {
  FiltersSection,
  type FilterWithId,
  type RuntimeFilterControl,
} from "./FiltersSection";
import { MetricsSection } from "./MetricsSection";
import { pruneRuntimeControls, stableValueSignature } from "./runtime-controls";
import { SortSection } from "./SortSection";

interface InsightConfigPanelProps {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  reportId?: string;
}

/**
 * InsightConfigPanel - Sectioned workbench pane for configuring an insight.
 *
 * Features:
 * - Tables, fields, metrics, filters, sort, and viewer-control sections
 * - Drag-and-drop reordering via @dnd-kit
 * - Anchored popover editors that preserve pending saves
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
  const filters = stripFilterClientMetadata(
    withFilterIds(insight.filters).filter((filter) => filter._id !== filterId),
  );
  const runtimeControls = pruneRuntimeControls(
    insight.runtimeControls,
    filters,
    [
      ...(insight.selectedFields ?? []),
      ...(insight.metrics ?? []).map((metric) => metric.id),
    ],
  );
  await commit({
    commands: [
      cmd("SetInsightFilter", { id: insight.id, filters }),
      ...(insight.runtimeControls
        ? [
            cmd("SetInsightRuntimeControls", {
              id: insight.id,
              runtimeControls,
            }),
          ]
        : []),
    ],
  });
}

type ConfigSection =
  | "tables"
  | "fields"
  | "metrics"
  | "filters"
  | "sort"
  | "viewer";

const CONFIG_SECTIONS: Array<{
  id: ConfigSection;
  label: string;
  icon: typeof Table2;
}> = [
  { id: "tables", label: "Tables", icon: Table2 },
  { id: "fields", label: "Fields", icon: Columns3 },
  { id: "metrics", label: "Metrics", icon: Sigma },
  { id: "filters", label: "Filters", icon: ListFilter },
  { id: "sort", label: "Sort", icon: ArrowUpDown },
  { id: "viewer", label: "Viewer controls", icon: Eye },
];
const CONFIG_SECTION_IDS: ConfigSection[] = CONFIG_SECTIONS.map(
  (section) => section.id,
);

export function InsightConfigPanel({
  insight,
  dataTable,
  allDataTables,
  reportId,
}: InsightConfigPanelProps) {
  const {
    openSections,
    allCollapsed,
    setSectionOpen,
    jumpToSection,
    toggleAll,
    registerSection,
  } = useWorkbenchPaneSections(CONFIG_SECTION_IDS);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(
    initialDeleteDialogState,
  );
  const [processingVizId, setProcessingVizId] = useState<string | null>(null);
  const updateWebMCPInsight = useWebMCPPageStore(
    (state) => state.updateInsight,
  );

  // Mutations — every artifact write goes through commitBatch (one batch per edit).
  const commitBatch = useMutation(api.app.commitBatch);
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
  const {
    data: insightVisualizations = [],
    isLoading: visualizationsLoading,
    isError: visualizationsError,
  } = queryStatus(
    useQuery({
      query: api.app.listVisualizations,
      args: { insightId: insight.id },
    }),
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
  // resolve. Offered in the filter popover picker so a saved filter always
  // produces a working predicate. FiltersSection also receives combinedFields
  // so excluded or stale selections retain their display treatment.
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
    async (runtimeControls: InsightRuntimeDeclaration | undefined) => {
      const commands = runtimeControls
        ? buildInsightUpdateCommands(insight.id, insight, { runtimeControls })
        : [
            cmd("SetInsightRuntimeControls", {
              id: insight.id,
              runtimeControls: undefined,
            }),
          ];
      try {
        await commitBatch({ commands });
        return true;
      } catch {
        toast.error("Failed to update viewer controls");
        return false;
      }
    },
    [commitBatch, insight],
  );

  /**
   * Stable client-side ids for filters, used for SortableList keying and for
   * matching an in-flight edit back to its predicate on save.
   *
   * `_id` is sourced from the filter's persisted `id` (generated on add by
   * the filter popover and the API write boundary, then preserved across
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
      updateWebMCPInsight(insight.id, { pendingSorts: nextSorts });
      updateInsight(insight.id, { sorts: nextSorts }).finally(() => {
        const live = useWebMCPPageStore.getState().insight;
        if (live?.insightId === insight.id && live.pendingSorts === nextSorts) {
          updateWebMCPInsight(insight.id, { pendingSorts: undefined });
        }
      });
    },
    [insight.id, updateInsight, updateWebMCPInsight],
  );

  // --- Field handlers ---
  const handleFieldsReorder = useCallback(
    (newOrder: string[]) => {
      updateInsight(insight.id, { selectedFields: newOrder });
    },
    [insight.id, updateInsight],
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
  const handleFiltersReorder = useCallback(
    (reordered: FilterWithId[]) => {
      const pendingFilters = stripFilterClientMetadata(reordered);
      updateWebMCPInsight(insight.id, { pendingFilters });
      updateInsight(insight.id, { filters: pendingFilters }).finally(() => {
        const live = useWebMCPPageStore.getState().insight;
        if (
          live?.insightId === insight.id &&
          live.pendingFilters === pendingFilters
        ) {
          updateWebMCPInsight(insight.id, { pendingFilters: undefined });
        }
      });
    },
    [insight.id, updateInsight, updateWebMCPInsight],
  );

  const handleRemoveFilter = useCallback(
    (filterId: string) => {
      void removeFilterThroughCommands(commitBatch, insight, filterId);
    },
    [commitBatch, insight],
  );

  const handleSaveFilter = useCallback(
    async (
      saved: FilterWithId,
      runtimeControl: RuntimeFilterControl | undefined,
    ) => {
      const updated = applyFilterSave(filtersWithIds, saved);
      const controls = [...(insight.runtimeControls?.filters ?? [])];
      const controlIndex = controls.findIndex(
        (control) => control.filterId === saved.id,
      );
      if (runtimeControl && controlIndex >= 0) {
        controls[controlIndex] = runtimeControl;
      } else if (runtimeControl) {
        controls.push(runtimeControl);
      } else if (controlIndex >= 0) {
        controls.splice(controlIndex, 1);
      }
      const runtimeControls: InsightRuntimeDeclaration = {
        ...insight.runtimeControls,
        filters: controls.length > 0 ? controls : undefined,
      };
      const nextRuntimeControls =
        runtimeControls.filters || runtimeControls.sort || runtimeControls.limit
          ? runtimeControls
          : undefined;
      const updates: Partial<Omit<Insight, "id" | "createdAt">> = {
        filters: stripFilterClientMetadata(updated),
      };
      if (
        stableValueSignature(nextRuntimeControls) !==
        stableValueSignature(insight.runtimeControls)
      ) {
        updates.runtimeControls = nextRuntimeControls;
      }
      await updateInsight(insight.id, updates);
    },
    [filtersWithIds, insight.id, insight.runtimeControls, updateInsight],
  );

  const handleFilterDraftChange = useCallback(
    (draft: FilterWithId | null) => {
      if (!draft) {
        updateWebMCPInsight(insight.id, { pendingFilters: undefined });
        return;
      }
      const pending =
        draft._id === "__new__"
          ? [...filtersWithIds, draft]
          : filtersWithIds.map((filter) =>
              filter._id === draft._id ? draft : filter,
            );
      updateWebMCPInsight(insight.id, {
        pendingFilters: stripFilterClientMetadata(pending),
      });
    },
    [filtersWithIds, insight.id, updateWebMCPInsight],
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

  const removeConfigItem = useCallback(
    (itemType: DeleteDialogState["itemType"], itemId: string) => {
      if (itemType === "field") {
        const updated = (insight.selectedFields ?? []).filter(
          (id) => id !== itemId,
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
        const updated = (insight.metrics ?? []).filter((m) => m.id !== itemId);
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
    },
    [
      insight.id,
      insight.selectedFields,
      insight.metrics,
      insight.filters,
      insight.runtimeControls,
      updateInsight,
    ],
  );

  const handleConfirmDelete = useCallback(
    () => removeConfigItem(deleteDialog.itemType, deleteDialog.itemId),
    [deleteDialog.itemId, deleteDialog.itemType, removeConfigItem],
  );

  // Removing a field or metric no saved chart uses applies immediately; it
  // still prunes any viewer controls tied to the item. Confirm when a chart
  // depends on it, or when the chart list hasn't loaded and that is unknown.
  const visualizationsKnown = !visualizationsLoading && !visualizationsError;
  let usageStatus: UsageStatus = "known";
  if (visualizationsLoading) usageStatus = "loading";
  else if (visualizationsError) usageStatus = "error";
  const handleRemoveField = useCallback(
    (fieldId: string) => {
      const field = combinedFields.find((f) => f.id === fieldId);
      if (!field) return;
      if (
        visualizationsKnown &&
        findVisualizationsUsingField(fieldId, insightVisualizations).length ===
          0
      ) {
        removeConfigItem("field", fieldId);
        return;
      }
      setDeleteDialog({
        isOpen: true,
        itemId: fieldId,
        itemName: field.displayName,
        itemType: "field",
      });
    },
    [
      combinedFields,
      insightVisualizations,
      removeConfigItem,
      visualizationsKnown,
    ],
  );

  const handleRemoveMetric = useCallback(
    (metricId: string) => {
      const metric = (insight.metrics ?? []).find((m) => m.id === metricId);
      if (!metric) return;
      if (
        visualizationsKnown &&
        findVisualizationsUsingMetric(metricId, insightVisualizations)
          .length === 0
      ) {
        removeConfigItem("metric", metricId);
        return;
      }
      setDeleteDialog({
        isOpen: true,
        itemId: metricId,
        itemName: metric.name,
        itemType: "metric",
      });
    },
    [
      insight.metrics,
      insightVisualizations,
      removeConfigItem,
      visualizationsKnown,
    ],
  );

  const resultLabelById = new Map(
    runtimeResultFields.map((field) => [field.id, field.label]),
  );
  const filterLabelById = new Map(
    filtersWithIds.flatMap((filter) =>
      filter.id
        ? [
            [
              filter.id,
              combinedFields.find(
                (field) => (field.columnName ?? field.name) === filter.field,
              )?.displayName ?? filter.field,
            ] as const,
          ]
        : [],
    ),
  );
  const viewerControls = [
    ...(insight.runtimeControls?.filters ?? []).map((control) => ({
      label: control.label,
      target: `${filterLabelById.get(control.filterId) ?? "Filter"} filter`,
    })),
    ...(insight.runtimeControls?.sort
      ? [
          {
            label: "Sort",
            target: insight.runtimeControls.sort.allowedFieldIds
              .map((id) => resultLabelById.get(id) ?? id)
              .join(", "),
          },
        ]
      : []),
    ...(insight.runtimeControls?.limit
      ? [
          {
            label: "Limit",
            target: `${insight.runtimeControls.limit.min}–${insight.runtimeControls.limit.max} rows`,
          },
        ]
      : []),
  ];
  const summaries: Record<ConfigSection, string> = {
    tables: [
      dataTable.name,
      ...(insight.joins ?? []).map(
        (join) =>
          allDataTables.find((table) => table.id === join.rightTableId)?.name ??
          "Unknown table",
      ),
    ].join(", "),
    fields:
      selectedFields.map((field) => field.displayName).join(", ") || "None",
    metrics: visibleMetrics.map((metric) => metric.name).join(", ") || "None",
    filters:
      filtersWithIds
        .map(
          (filter) =>
            combinedFields.find(
              (field) => (field.columnName ?? field.name) === filter.field,
            )?.displayName ?? filter.field,
        )
        .join(", ") || "None",
    sort:
      sorts
        .map((sort) => {
          const field = selectedFields.find(
            (candidate) =>
              (candidate.columnName ?? candidate.name) === sort.field,
          );
          const metric = visibleMetrics.find(
            (candidate) => `metric_${candidate.id}` === sort.field,
          );
          return `${field?.displayName ?? metric?.name ?? sort.field} ${sort.direction}`;
        })
        .join(", ") || "None",
    viewer: viewerControls.map((control) => control.label).join(", ") || "None",
  };
  const renderSection = (id: ConfigSection, children: ReactNode) => {
    const section = CONFIG_SECTIONS.find((item) => item.id === id)!;
    return (
      <WorkbenchPaneSection
        key={id}
        ref={registerSection(id)}
        title={section.label}
        icon={section.icon}
        open={openSections[id]}
        summary={summaries[id]}
        onOpenChange={(open) => setSectionOpen(id, open)}
      >
        {children}
      </WorkbenchPaneSection>
    );
  };

  return (
    <div className="flex h-full flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Insight">
        <WorkbenchJumpBar
          items={CONFIG_SECTIONS}
          onJump={(id) => jumpToSection(id as ConfigSection)}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      </WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-3">
          {renderSection(
            "tables",
            <DataModelSection
              insight={insight}
              dataTable={dataTable}
              allDataTables={allDataTables}
              reportId={reportId}
            />,
          )}
          {renderSection(
            "fields",
            <FieldsSection
              selectedFields={selectedFields}
              availableFields={availableFields}
              tables={[
                dataTable,
                ...allDataTables.filter((table) => table.id !== dataTable.id),
              ]}
              baseTableId={dataTable.id}
              onReorder={handleFieldsReorder}
              onRemove={handleRemoveField}
              onRename={handleRenameField}
              onAdd={handleAddField}
            />,
          )}
          {renderSection(
            "metrics",
            <MetricsSection
              metrics={visibleMetrics}
              dataTable={dataTable}
              onReorder={handleMetricsReorder}
              onRemove={handleRemoveMetric}
              onAdd={handleAddMetric}
              onEdit={handleEditMetric}
            />,
          )}
          {renderSection(
            "filters",
            <FiltersSection
              filters={filtersWithIds}
              combinedFields={filterableFields}
              displayFields={combinedFields}
              runtimeControls={insight.runtimeControls}
              onReorder={handleFiltersReorder}
              onRemove={handleRemoveFilter}
              onSave={handleSaveFilter}
              onDraftChange={handleFilterDraftChange}
            />,
          )}
          {renderSection(
            "sort",
            <SortSection
              sorts={sorts}
              fields={selectedFields}
              metrics={visibleMetrics}
              runtimeControls={insight.runtimeControls}
              onChange={handleSortsChange}
              onRuntimeChange={handleRuntimeControlsChange}
            />,
          )}
          {renderSection(
            "viewer",
            viewerControls.length > 0 ? (
              <dl className="space-y-1 px-1">
                {viewerControls.map((control) => (
                  <div
                    key={`${control.label}:${control.target}`}
                    className="flex gap-3"
                  >
                    <dt className="min-w-0 flex-1 truncate font-medium">
                      {control.label}
                    </dt>
                    <dd className="min-w-0 flex-1 truncate text-right text-neutral-fg-subtle">
                      {control.target}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-1 text-neutral-fg-subtle">Nothing exposed.</p>
            ),
          )}
        </div>
      </OverlayScrollArea>
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        itemName={deleteDialog.itemName}
        itemType={deleteDialog.itemType}
        affectedVisualizations={affectedVisualizations}
        usageStatus={usageStatus}
        processingVizId={processingVizId}
        onClose={handleCloseDeleteDialog}
        onRemoveFromVisualization={handleRemoveFromVisualization}
        onDeleteVisualization={handleDeleteVisualization}
        onDelete={handleConfirmDelete}
      />
    </div>
  );
}
