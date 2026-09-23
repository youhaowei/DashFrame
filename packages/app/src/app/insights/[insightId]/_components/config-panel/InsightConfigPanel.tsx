import { measureFilterFields } from "@/lib/insights/measure-filter-fields";
import type { PivotSortOption } from "@/lib/insights/pivot-sort-options";
import { ReportPeriodControl, ReportResultOptions } from "./ReportSettings";
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
import {
  metricIdToColumnAlias,
  saveReusableMeasure,
  importReusableMeasure,
} from "@dashframe/engine";
import { MeasureLibraryControls } from "./MeasureLibraryControls";
import type {
  Command,
  DataTable,
  Insight,
  InsightMetric,
  MeasureExpression,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import {
  pruneRuntimeControls,
  stableValueSignature,
  withoutViewerField,
} from "./runtime-controls";
import { SortSection } from "./SortSection";

interface InsightConfigPanelProps {
  pivotSortOptions?: PivotSortOption[];
  pivotSortError?: string;
  onPivotSortRetry?: () => void;
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  reportId?: string;
  /** Labels for result columns, keyed by column alias. */
  columnDisplayNames?: Readonly<Record<string, string>>;
  /** Coordinates dependency-sensitive removals with chart writes. */
  getVisualizationWriteStatus?: () => {
    pending: boolean;
    generation: number;
  };
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
  writeRuntimeControls = insight.runtimeControls !== undefined,
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
      ...(writeRuntimeControls
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

function referencesMeasure(
  expression: MeasureExpression | undefined,
  id: string,
): boolean {
  if (!expression || expression.kind === "constant") return false;
  return expression.kind === "measure"
    ? expression.measureId === id
    : referencesMeasure(expression.left, id) ||
        referencesMeasure(expression.right, id);
}

export function InsightConfigPanel({
  pivotSortOptions,
  pivotSortError,
  onPivotSortRetry,
  insight,
  dataTable,
  allDataTables,
  reportId,
  columnDisplayNames,
  getVisualizationWriteStatus = () => ({ pending: false, generation: 0 }),
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
  const [localRuntimeControls, setLocalRuntimeControls] = useState(
    insight.runtimeControls,
  );
  const runtimeControlsRef = useRef(insight.runtimeControls);
  // The latest server value, including echoes ignored while a newer write is
  // pending. A failed write rolls back to this, not the value it started from.
  const echoedRuntimeControlsRef = useRef(insight.runtimeControls);
  const pendingRuntimeControlsSignatureRef = useRef<string | null>(null);
  const runtimeControlsSignature = stableValueSignature(
    insight.runtimeControls ?? null,
  );
  useEffect(() => {
    echoedRuntimeControlsRef.current = insight.runtimeControls;
    if (
      pendingRuntimeControlsSignatureRef.current === null ||
      pendingRuntimeControlsSignatureRef.current === runtimeControlsSignature
    ) {
      runtimeControlsRef.current = insight.runtimeControls;
      setLocalRuntimeControls(insight.runtimeControls);
      pendingRuntimeControlsSignatureRef.current = null;
    }
  }, [insight.runtimeControls, runtimeControlsSignature]);
  const stageRuntimeControls = useCallback(
    (runtimeControls: InsightRuntimeDeclaration | undefined) => {
      const signature = stableValueSignature(runtimeControls ?? null);
      runtimeControlsRef.current = runtimeControls;
      setLocalRuntimeControls(runtimeControls);
      pendingRuntimeControlsSignatureRef.current = signature;
      return signature;
    },
    [],
  );
  const rollbackRuntimeControls = useCallback((signature: string) => {
    if (pendingRuntimeControlsSignatureRef.current !== signature) return;
    runtimeControlsRef.current = echoedRuntimeControlsRef.current;
    setLocalRuntimeControls(echoedRuntimeControlsRef.current);
    pendingRuntimeControlsSignatureRef.current = null;
  }, []);
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
  const aggregateFilterFields = useMemo(
    () => measureFilterFields(insight, combinedFields),
    [insight, combinedFields],
  );
  const filterableFields = useMemo(
    () => [
      ...computeFilterableFields(combinedFields, insight.joins),
      ...aggregateFilterFields,
    ],
    [combinedFields, insight.joins, aggregateFilterFields],
  );
  const filterDisplayFields = useMemo(
    () => [...combinedFields, ...aggregateFilterFields],
    [combinedFields, aggregateFilterFields],
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
      const nextSignature = stageRuntimeControls(runtimeControls);
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
        rollbackRuntimeControls(nextSignature);
        toast.error("Failed to update viewer controls");
        return false;
      }
    },
    [commitBatch, insight, rollbackRuntimeControls, stageRuntimeControls],
  );

  const saveViewerChoices = async (
    kind: "dimensions" | "measures",
    ids: string[],
  ) => {
    // Build on the staged value so a change made before the last echo lands
    // is not overwritten.
    const controls = {
      ...runtimeControlsRef.current,
      [kind]: ids.length
        ? { allowedIds: ids, maxSelected: Math.min(16, ids.length) }
        : undefined,
    };
    if (!(await handleRuntimeControlsChange(controls)))
      throw new Error("Could not save viewer choices.");
  };
  const setViewerChoice = (
    kind: "dimensions" | "measures",
    id: string,
    enabled: boolean,
  ) => {
    const current = runtimeControlsRef.current?.[kind]?.allowedIds ?? [];
    const next = current.filter((value) => value !== id);
    if (enabled) next.push(id as UUID);
    return saveViewerChoices(kind, next);
  };

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

  const latestInsightRef = useRef(insight);
  useEffect(() => {
    latestInsightRef.current = insight;
  }, [insight]);

  // --- Field handlers ---
  // Full selected-field lists share one queue. Each add, reorder, or removal
  // composes from the last successful write until its subscription echo.
  const succeededSelectedFieldsRef = useRef<UUID[] | null>(null);
  const selectedFieldWriteQueueRef = useRef<Promise<unknown>>(
    Promise.resolve(),
  );
  useEffect(() => {
    succeededSelectedFieldsRef.current = null;
  }, [insight.selectedFields]);
  const writeSelectedFields = useCallback(
    (
      compose: (base: UUID[]) => UUID[],
      extraCommands: (current: Insight, next: UUID[]) => Command[] = () => [],
    ) => {
      const write = selectedFieldWriteQueueRef.current.then(async () => {
        const current = latestInsightRef.current;
        const base = succeededSelectedFieldsRef.current ?? [
          ...(current.selectedFields ?? []),
        ];
        const next = compose(base);
        const commands = [
          ...buildInsightUpdateCommands(
            current.id,
            { ...current, selectedFields: base },
            { selectedFields: next },
          ),
          ...extraCommands(current, next),
        ];
        if (commands.length === 0) return;
        await commitBatch({ commands });
        succeededSelectedFieldsRef.current = next;
      });
      selectedFieldWriteQueueRef.current = write.catch(() => {});
      return write;
    },
    [commitBatch],
  );

  const handleFieldsReorder = useCallback(
    (newOrder: string[]) => {
      void writeSelectedFields((fields) => {
        const surviving = new Set(fields);
        const seen = new Set<string>();
        const reorderedSurvivors = newOrder.flatMap((id) => {
          if (!surviving.has(id as UUID) || seen.has(id)) return [];
          seen.add(id);
          return [id as UUID];
        });
        return [...reorderedSurvivors, ...fields.filter((id) => !seen.has(id))];
      });
    },
    [writeSelectedFields],
  );

  const handleAddField = useCallback(
    (fieldId: string) => {
      void writeSelectedFields((fields) =>
        fields.includes(fieldId as UUID)
          ? fields
          : [...fields, fieldId as UUID],
      );
    },
    [writeSelectedFields],
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
  // Metric popovers save independently. Writes run one at a time, and each
  // composes when it starts against the last successful list, so a save never
  // drops an earlier one and a failed save never lingers in a later diff base.
  // A successful write whose echo may not have rendered yet.
  const succeededMetricsRef = useRef<InsightMetric[] | null>(null);
  const metricWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    succeededMetricsRef.current = null;
  }, [insight.metrics]);
  const writeMetrics = useCallback(
    (
      compose: (base: InsightMetric[]) => InsightMetric[],
      extraCommands: (next: InsightMetric[]) => Command[] = () => [],
    ) => {
      const write = metricWriteQueueRef.current.then(async () => {
        const current = latestInsightRef.current;
        const base = succeededMetricsRef.current ?? current.metrics ?? [];
        const next = compose(base);
        const commands = [
          ...buildInsightUpdateCommands(
            current.id,
            { ...current, metrics: base },
            { metrics: next },
          ),
          ...extraCommands(next),
        ];
        if (commands.length === 0) return;
        await commitBatch({ commands });
        succeededMetricsRef.current = next;
      });
      metricWriteQueueRef.current = write.catch(() => {});
      return write;
    },
    [commitBatch],
  );

  const handleMetricsReorder = useCallback(
    (newOrder: InsightMetric[]) => {
      void writeMetrics((metrics) => reorderVisibleMetrics(metrics, newOrder));
    },
    [writeMetrics],
  );

  const handleAddMetric = useCallback(
    (metric: InsightMetric) => writeMetrics((metrics) => [...metrics, metric]),
    [writeMetrics],
  );

  const handleSaveReusableMeasure = useCallback(
    async (metricId: string) => {
      await metricWriteQueueRef.current;
      const current = latestInsightRef.current;
      const saved = saveReusableMeasure(
        succeededMetricsRef.current ?? current.metrics,
        metricId,
        dataTable.id,
      );
      await commitBatch({
        commands: saved.map((metric) =>
          cmd("AddMetric", { nodeId: dataTable.id, metric }),
        ),
      });
      toast.success("Measure saved to source");
    },
    [commitBatch, dataTable.id],
  );

  const handleReuseMeasure = useCallback(
    async (metricId: string) => {
      const imported = importReusableMeasure(
        dataTable.metrics ?? [],
        metricId,
        dataTable.id,
      );
      await writeMetrics(
        (metrics) => [...metrics, ...imported],
        () => {
          const current = latestInsightRef.current;
          if (!current.reporting?.measureIds) return [];
          return [
            cmd("SetInsightReporting", {
              id: current.id,
              reporting: {
                ...current.reporting,
                measureIds: [
                  ...current.reporting.measureIds,
                  imported.at(-1)!.id,
                ],
              },
            }),
          ];
        },
      );
    },
    [dataTable.id, dataTable.metrics, writeMetrics],
  );

  const handleEditMetric = useCallback(
    (updatedMetric: InsightMetric) =>
      writeMetrics((metrics) => {
        if (!metrics.some((metric) => metric.id === updatedMetric.id)) {
          throw new Error("Metric no longer exists");
        }
        return metrics.map((metric) =>
          metric.id === updatedMetric.id ? updatedMetric : metric,
        );
      }),
    [writeMetrics],
  );

  // --- Filter handlers ---
  // Filter popovers can save independently. Serialize their full-list writes
  // and compose each one from the last successful list until its echo renders.
  const succeededFiltersRef = useRef<Insight["filters"] | null>(null);
  const filterWriteQueueRef = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    succeededFiltersRef.current = null;
  }, [insight.filters]);
  const writeFilters = useCallback(
    (
      run: (
        baseFilters: NonNullable<Insight["filters"]>,
        current: Insight,
      ) => Promise<NonNullable<Insight["filters"]>>,
    ) => {
      const execute = async () => {
        const current = latestInsightRef.current;
        const baseFilters =
          succeededFiltersRef.current ?? current.filters ?? [];
        const nextFilters = await run(baseFilters, current);
        succeededFiltersRef.current = nextFilters;
      };
      const previous = filterWriteQueueRef.current;
      // Start the first write synchronously so its ordering relative to viewer
      // control edits matches the user's event order. Later filter mutations
      // compose after the prior one succeeds or fails.
      const write = previous ? previous.then(execute) : execute();
      const tail = write.catch(() => {});
      filterWriteQueueRef.current = tail;
      tail
        .then(() => {
          if (filterWriteQueueRef.current === tail) {
            filterWriteQueueRef.current = null;
          }
        })
        .catch(() => {});
      return write;
    },
    [],
  );
  const handleFiltersReorder = useCallback(
    (reordered: FilterWithId[]) => {
      writeFilters(async (baseFilters, current) => {
        const baseWithIds = withFilterIds(baseFilters);
        const byId = new Map(baseWithIds.map((filter) => [filter._id, filter]));
        const reorderedIds = new Set<string>();
        const reorderedSurvivors = reordered.flatMap((filter) => {
          const survivor = byId.get(filter._id);
          if (!survivor || reorderedIds.has(filter._id)) return [];
          reorderedIds.add(filter._id);
          return [survivor];
        });
        const pendingFilters = stripFilterClientMetadata([
          ...reorderedSurvivors,
          ...baseWithIds.filter((filter) => !reorderedIds.has(filter._id)),
        ]);
        updateWebMCPInsight(current.id, { pendingFilters });
        try {
          await updateInsight(current.id, { filters: pendingFilters });
          return pendingFilters;
        } finally {
          const live = useWebMCPPageStore.getState().insight;
          if (
            live?.insightId === current.id &&
            live.pendingFilters === pendingFilters
          ) {
            updateWebMCPInsight(current.id, { pendingFilters: undefined });
          }
        }
      }).catch(() => {});
    },
    [updateInsight, updateWebMCPInsight, writeFilters],
  );

  const handleRemoveFilter = useCallback(
    (filterId: string) => {
      writeFilters(async (baseFilters, current) => {
        const baseRuntimeControls = runtimeControlsRef.current;
        const filters = stripFilterClientMetadata(
          withFilterIds(baseFilters).filter(
            (filter) => filter._id !== filterId,
          ),
        );
        const nextRuntimeControls = pruneRuntimeControls(
          baseRuntimeControls,
          filters,
          [
            ...(current.selectedFields ?? []),
            ...(current.metrics ?? []).map((metric) => metric.id),
          ],
        );
        const writesRuntimeControls =
          pendingRuntimeControlsSignatureRef.current !== null ||
          stableValueSignature(nextRuntimeControls) !==
            stableValueSignature(current.runtimeControls);
        const signature = writesRuntimeControls
          ? stageRuntimeControls(nextRuntimeControls)
          : null;
        try {
          await removeFilterThroughCommands(
            commitBatch,
            {
              ...current,
              filters: baseFilters,
              runtimeControls: baseRuntimeControls,
            },
            filterId,
            writesRuntimeControls,
          );
          return filters;
        } catch (error) {
          if (signature) rollbackRuntimeControls(signature);
          throw error;
        }
      }).catch(() => {});
    },
    [commitBatch, rollbackRuntimeControls, stageRuntimeControls, writeFilters],
  );

  const handleSaveFilter = useCallback(
    (saved: FilterWithId, runtimeControl: RuntimeFilterControl | undefined) => {
      return writeFilters(async (baseFilters, current) => {
        const updated = applyFilterSave(withFilterIds(baseFilters), saved);
        const nextFilters = stripFilterClientMetadata(updated);
        const baseRuntimeControls = runtimeControlsRef.current;
        const controls = [...(baseRuntimeControls?.filters ?? [])];
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
          ...baseRuntimeControls,
          filters: controls.length > 0 ? controls : undefined,
        };
        const nextRuntimeControls =
          runtimeControls.filters ||
          runtimeControls.sort ||
          runtimeControls.limit ||
          runtimeControls.dimensions ||
          runtimeControls.measures
            ? runtimeControls
            : undefined;
        const updates: Partial<Omit<Insight, "id" | "createdAt">> = {
          filters: nextFilters,
        };
        const writesRuntimeControls =
          stableValueSignature(nextRuntimeControls) !==
          stableValueSignature(baseRuntimeControls);
        if (writesRuntimeControls) {
          updates.runtimeControls = nextRuntimeControls;
        }
        const nextSignature = stableValueSignature(nextRuntimeControls ?? null);
        if (writesRuntimeControls) {
          stageRuntimeControls(nextRuntimeControls);
        }
        const commands = buildInsightUpdateCommands(
          current.id,
          {
            ...current,
            filters: baseFilters,
            runtimeControls: baseRuntimeControls,
          },
          updates,
        );
        try {
          await commitBatch({ commands });
          return nextFilters;
        } catch (error) {
          if (
            writesRuntimeControls &&
            pendingRuntimeControlsSignatureRef.current === nextSignature
          ) {
            rollbackRuntimeControls(nextSignature);
          }
          throw error;
        }
      });
    },
    [commitBatch, rollbackRuntimeControls, stageRuntimeControls, writeFilters],
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
    (
      itemType: DeleteDialogState["itemType"],
      itemId: string,
      requestedWriteGeneration = getVisualizationWriteStatus().generation,
    ) => {
      if (getVisualizationWriteStatus().pending) {
        toast.error(
          "Wait for the chart update to finish before removing this item",
        );
        return;
      }
      if (itemType === "field") {
        let signature: string | null = null;
        writeSelectedFields(
          (fields) => {
            const writeStatus = getVisualizationWriteStatus();
            if (
              writeStatus.pending ||
              writeStatus.generation !== requestedWriteGeneration
            ) {
              throw new Error("Visualization update still pending");
            }
            return fields.filter((id) => id !== itemId);
          },
          (current, fields) => {
            const nextRuntimeControls = withoutViewerField(
              pruneRuntimeControls(
                runtimeControlsRef.current,
                current.filters ?? [],
                [
                  ...fields,
                  ...(current.metrics ?? []).map((metric) => metric.id),
                ],
              ),
              itemId as UUID,
            );
            if (
              pendingRuntimeControlsSignatureRef.current === null &&
              stableValueSignature(nextRuntimeControls) ===
                stableValueSignature(echoedRuntimeControlsRef.current)
            ) {
              return [];
            }
            signature = stageRuntimeControls(nextRuntimeControls);
            return [
              cmd("SetInsightRuntimeControls", {
                id: current.id,
                runtimeControls: nextRuntimeControls,
              }),
            ];
          },
        ).catch((error: unknown) => {
          if (signature) rollbackRuntimeControls(signature);
          toast.error(
            error instanceof Error ? error.message : "Unable to remove field",
          );
        });
      } else {
        // Prune viewer controls when the queued removal runs, so it builds on
        // any viewer-control save made while earlier metric writes were pending.
        let signature: string | null = null;
        writeMetrics(
          (metrics) => {
            const writeStatus = getVisualizationWriteStatus();
            if (
              writeStatus.pending ||
              writeStatus.generation !== requestedWriteGeneration
            ) {
              throw new Error("Visualization update still pending");
            }
            const dependent = metrics.find(
              (metric) =>
                metric.id !== itemId &&
                referencesMeasure(metric.expression, itemId),
            );
            if (dependent) {
              const removed = metrics.find((metric) => metric.id === itemId);
              throw new Error(
                `Cannot remove "${removed?.name ?? "measure"}" because "${dependent.name}" depends on it. Remove or update "${dependent.name}" first.`,
              );
            }
            return metrics.filter((metric) => metric.id !== itemId);
          },
          (metrics) => {
            const current = latestInsightRef.current;
            const nextRuntimeControls = pruneRuntimeControls(
              runtimeControlsRef.current,
              current.filters ?? [],
              [
                ...(current.selectedFields ?? []),
                ...metrics.map((metric) => metric.id),
              ],
            );
            if (
              pendingRuntimeControlsSignatureRef.current === null &&
              stableValueSignature(nextRuntimeControls) ===
                stableValueSignature(echoedRuntimeControlsRef.current)
            ) {
              return [];
            }
            signature = stageRuntimeControls(nextRuntimeControls);
            return [
              cmd("SetInsightRuntimeControls", {
                id: current.id,
                runtimeControls: nextRuntimeControls,
              }),
            ];
          },
        ).catch((error: unknown) => {
          if (signature) rollbackRuntimeControls(signature);
          toast.error(
            error instanceof Error ? error.message : "Unable to remove measure",
          );
        });
      }
    },
    [
      rollbackRuntimeControls,
      stageRuntimeControls,
      writeMetrics,
      writeSelectedFields,
      getVisualizationWriteStatus,
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
      const writeStatus = getVisualizationWriteStatus();
      if (writeStatus.pending) {
        toast.error(
          "Wait for the chart update to finish before removing this field",
        );
        return;
      }
      const field = combinedFields.find((f) => f.id === fieldId);
      if (!field) return;
      if (
        visualizationsKnown &&
        findVisualizationsUsingField(fieldId, insightVisualizations).length ===
          0
      ) {
        removeConfigItem("field", fieldId, writeStatus.generation);
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
      getVisualizationWriteStatus,
    ],
  );

  const handleRemoveMetric = useCallback(
    (metricId: string) => {
      const writeStatus = getVisualizationWriteStatus();
      if (writeStatus.pending) {
        toast.error(
          "Wait for the chart update to finish before removing this metric",
        );
        return;
      }
      const metric = (insight.metrics ?? []).find((m) => m.id === metricId);
      if (!metric) return;
      if (
        visualizationsKnown &&
        findVisualizationsUsingMetric(metricId, insightVisualizations)
          .length === 0
      ) {
        removeConfigItem("metric", metricId, writeStatus.generation);
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
      getVisualizationWriteStatus,
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
    ...(localRuntimeControls?.dimensions
      ? [
          {
            label: "Dimensions",
            target: `${localRuntimeControls.dimensions.allowedIds.length} choices`,
          },
        ]
      : []),
    ...(localRuntimeControls?.measures
      ? [
          {
            label: "Measures",
            target: `${localRuntimeControls.measures.allowedIds.length} choices`,
          },
        ]
      : []),
    ...(localRuntimeControls?.filters ?? []).map((control) => ({
      label: control.label,
      target: `${filterLabelById.get(control.filterId) ?? "Filter"} filter`,
    })),
    ...(localRuntimeControls?.sort
      ? [
          {
            label: "Sort",
            target: localRuntimeControls.sort.allowedFieldIds
              .map((id) => resultLabelById.get(id) ?? id)
              .join(", "),
          },
        ]
      : []),
    ...(localRuntimeControls?.limit
      ? [
          {
            label: "Limit",
            target: `${localRuntimeControls.limit.min}–${localRuntimeControls.limit.max} rows`,
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
            (candidate) => metricIdToColumnAlias(candidate.id) === sort.field,
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
            <>
              <FieldsSection
                reporting={insight.reporting}
                onConfigure={async (fieldId, grain, pivot) => {
                  const current = latestInsightRef.current;
                  const reporting = { ...current.reporting };
                  const dateGrains = { ...reporting.dateGrains };
                  if (grain) dateGrains[fieldId] = grain;
                  else delete dateGrains[fieldId];
                  const pivotFields = (reporting.pivotFields ?? []).filter(
                    (id) => id !== fieldId,
                  );
                  if (pivot) pivotFields.push(fieldId);
                  await updateInsight(current.id, {
                    reporting: { ...reporting, dateGrains, pivotFields },
                  });
                }}
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
                viewerFieldIds={
                  localRuntimeControls?.dimensions?.allowedIds ?? []
                }
                onViewerChange={(id, enabled) =>
                  setViewerChoice("dimensions", id, enabled)
                }
              />
            </>,
          )}
          {renderSection(
            "metrics",
            <>
              <MetricsSection
                metrics={visibleMetrics}
                dataTable={dataTable}
                columnDisplayNames={columnDisplayNames}
                onReorder={handleMetricsReorder}
                onRemove={handleRemoveMetric}
                onAdd={handleAddMetric}
                onEdit={handleEditMetric}
                viewerMetricIds={
                  localRuntimeControls?.measures?.allowedIds ?? []
                }
                onViewerChange={(id, enabled) =>
                  setViewerChoice("measures", id, enabled)
                }
              />
              {insight.source.sourceType === "dataTable" &&
                !insight.joins?.length && (
                  <MeasureLibraryControls
                    metrics={visibleMetrics}
                    saved={dataTable.metrics ?? []}
                    onSave={handleSaveReusableMeasure}
                    onReuse={handleReuseMeasure}
                  />
                )}
            </>,
          )}
          {renderSection(
            "filters",
            <>
              <FiltersSection
                filters={filtersWithIds}
                combinedFields={filterableFields}
                displayFields={filterDisplayFields}
                runtimeControls={localRuntimeControls}
                onReorder={handleFiltersReorder}
                onRemove={handleRemoveFilter}
                onSave={handleSaveFilter}
                onDraftChange={handleFilterDraftChange}
              />
              <ReportPeriodControl
                insight={insight}
                fields={combinedFields}
                onChange={async (patch) => {
                  const current = latestInsightRef.current;
                  await updateInsight(current.id, {
                    reporting: { ...current.reporting, ...patch },
                  });
                }}
              />
            </>,
          )}
          {renderSection(
            "sort",
            <>
              <SortSection
                pivotOptions={pivotSortOptions}
                pivotError={pivotSortError}
                onPivotRetry={onPivotSortRetry}
                sorts={sorts}
                fields={selectedFields}
                metrics={visibleMetrics}
                runtimeControls={localRuntimeControls}
                onChange={handleSortsChange}
                onRuntimeChange={handleRuntimeControlsChange}
              />
              <ReportResultOptions
                insight={insight}
                fields={selectedFields}
                onChange={async (patch) => {
                  const current = latestInsightRef.current;
                  await updateInsight(current.id, {
                    reporting: { ...current.reporting, ...patch },
                  });
                }}
              />
            </>,
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
