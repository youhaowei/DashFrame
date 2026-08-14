import { AppLayout } from "@/components/layouts/AppLayout";
import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import { formatCellValue } from "@/lib/cell-formatter";
import {
  useConfirmDialogStore,
  type ConfirmDialogConfig,
} from "@/lib/stores/confirm-dialog-store";
import {
  canvasViewsEqual,
  sanitizeInsightCanvasView,
  TABLE_CANVAS_VIEW,
  useInsightCanvasStore,
  type InsightCanvasView,
} from "@/lib/stores/insight-canvas-store";
import type { Insight as LocalInsight } from "@/lib/stores/types";
import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import {
  suggestByChartType,
  type ChartSuggestion,
} from "@/lib/visualizations/suggest-charts";
import { api } from "@/wystack/api";
import {
  extractUUIDFromColumnAlias,
  fieldIdToColumnAlias,
} from "@dashframe/engine";
import type {
  ChartEncoding,
  ColumnAnalysis,
  CommandPayloads,
  Field,
  Insight,
  InsightMetric,
  UUID,
  VegaLiteSpec,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import {
  buildInsightUpdateCommands,
  CHART_TYPE_METADATA,
  cmd,
  fieldEncoding,
  metricEncoding,
} from "@dashframe/types";
import {
  CHART_ICONS,
  ControlTooltip,
  VirtualTable,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
import { Chart } from "@dashframe/visualization";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@wystack/client";
import { Button, cn } from "@wystack/ui-react";
import {
  DashboardIcon,
  PlusIcon,
  SparklesIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { InsightConfigPanel } from "./config-panel";
import { NotFoundView } from "./NotFoundView";

export function requestSavedVisualizationDeletion(
  confirm: (config: ConfirmDialogConfig) => void,
  removeVisualization: (args: { id: string }) => Promise<unknown>,
  vizId: string,
  name: string,
): void {
  confirm({
    title: "Delete visualization",
    description: `Are you sure you want to delete "${name}"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.`,
    confirmLabel: "Delete",
    variant: "destructive",
    onConfirm: async () => {
      try {
        await removeVisualization({ id: vizId });
      } catch {
        toast.error("Couldn't delete the visualization");
      }
    },
  });
}

/**
 * Chart suggestions inspect the complete joined result shape, independently of
 * the fields selected by the currently saved visualization. The definition is
 * still a typed, server-resolved authoring preview: callers provide no source,
 * provider, SQL, or placement details.
 */
export function buildChartSuggestionInsight(insight: Insight): Insight {
  return {
    ...insight,
    selectedFields: [],
    metrics: [],
    filters: undefined,
    sorts: undefined,
  };
}

export function canAttemptVisualizeIntent(input: {
  visualizeIntent: boolean;
  alreadyAttempted: boolean;
  hasVisualization: boolean;
  hasSuggestion: boolean;
  hasDataFrame: boolean;
  isChartViewReady: boolean;
}): boolean {
  return (
    input.visualizeIntent &&
    !input.alreadyAttempted &&
    !input.hasVisualization &&
    input.hasSuggestion &&
    input.hasDataFrame &&
    input.isChartViewReady
  );
}

export function resolveVisualModeTarget(input: {
  firstPinnedVisualizationId?: string;
  suggestionsReady: boolean;
  firstSuggestedChartType?: VisualizationType;
}): InsightCanvasView | null {
  if (input.firstPinnedVisualizationId) {
    return visualizationView(input.firstPinnedVisualizationId);
  }
  if (!input.suggestionsReady) return null;
  return input.firstSuggestedChartType
    ? chartView(input.firstSuggestedChartType)
    : null;
}

export function resolvePendingVisualModeTarget(input: {
  requestedInsightId: string | null;
  currentInsightId: string;
  firstPinnedVisualizationId?: string;
  suggestionsReady: boolean;
  firstSuggestedChartType?: VisualizationType;
}): InsightCanvasView | null {
  if (input.requestedInsightId !== input.currentInsightId) return null;
  return resolveVisualModeTarget(input);
}

interface InsightViewProps {
  insight: Insight;
  visualizeIntent?: boolean;
}

interface ParsedEncoding {
  dimensionFields: string[];
  metrics: InsightMetric[];
}

/**
 * Unwrap a date-transform expression to its underlying column reference.
 * Suggestion encodings wrap temporal axes in either legacy vgplot functions
 * (dateMonth(col)) or DuckDB date_trunc('period', "col"); the transform itself
 * travels separately as xTransform/yTransform, so field resolution must look
 * through the wrapper to the raw column alias.
 */
function unwrapEncodingExpression(value: string): string {
  const legacyMatch = value.match(
    /^(?:dateMonth|dateYear|dateDay|monthname|dayname|quarter)\(([^)]+)\)$/i,
  );
  if (legacyMatch?.[1]) {
    return legacyMatch[1].replace(/(?:^["'])|(?:["']$)/g, "");
  }
  const dateTruncMatch = value.match(/^date_trunc\('[^']+',\s*"([^"]+)"\)$/i);
  if (dateTruncMatch?.[1]) {
    return dateTruncMatch[1];
  }
  return value.replace(/(?:^["'])|(?:["']$)/g, "");
}

/**
 * Resolve an encoding channel value to a CANONICAL field ID. Tries, in order:
 * the raw value, the value with date-transform wrappers removed, and finally
 * the canonical UUID behind an instance-qualified repeat-join alias
 * (field_<uuid>_jN). Use this for the persisted Insight model
 * (selectedFields/metrics), which stores canonical field IDs only.
 */
function lookupEncodingFieldId(
  fieldIdMap: Map<string, UUID>,
  value: string,
): UUID | undefined {
  const direct = fieldIdMap.get(value);
  if (direct) return direct;

  const unwrapped = unwrapEncodingExpression(value);
  const unwrappedId = fieldIdMap.get(unwrapped);
  if (unwrappedId) return unwrappedId;

  const canonicalUuid = extractUUIDFromColumnAlias(unwrapped);
  if (canonicalUuid) {
    return fieldIdMap.get(fieldIdToColumnAlias(canonicalUuid));
  }
  return undefined;
}

/**
 * Like lookupEncodingFieldId, but PRESERVES the repeat-join instance
 * qualifier: a `field_<uuid>_jN` alias resolves to `<uuid>_jN`, not the
 * canonical UUID. Visualization encodings support instance-qualified refs
 * (VisualizationPreview resolves `field:<uuid>_jN` through the pagination
 * hook's instance-aware fields), and collapsing to canonical would silently
 * re-point the pinned chart at the FIRST join instance. Use this for
 * VisualizationEncoding values; use lookupEncodingFieldId for the Insight
 * model.
 */
function lookupEncodingFieldRef(
  fieldIdMap: Map<string, UUID>,
  value: string,
): UUID | undefined {
  const direct = fieldIdMap.get(value);
  if (direct) return direct;

  const unwrapped = unwrapEncodingExpression(value);
  const unwrappedId = fieldIdMap.get(unwrapped);
  if (unwrappedId) return unwrappedId;

  const canonicalUuid = extractUUIDFromColumnAlias(unwrapped);
  if (!canonicalUuid) return undefined;
  const canonicalId = fieldIdMap.get(fieldIdToColumnAlias(canonicalUuid));
  if (!canonicalId) return undefined;

  const instanceSuffix = unwrapped.match(/(_j\d+)$/)?.[1];
  // The instance-qualified id is not a bare UUID, but it IS the id the
  // render path's instance-aware fields carry — the cast is the seam where
  // the two id spaces meet.
  return instanceSuffix
    ? (`${canonicalId}${instanceSuffix}` as UUID)
    : canonicalId;
}

/**
 * Parse a single encoding axis value to determine if it's a dimension or metric.
 * Dimensions are raw field names, metrics are aggregation expressions like "sum(revenue)".
 *
 * @param value - The encoding value (e.g., "category" or "sum(revenue)")
 * @param parseAggregateExpression - Function to parse aggregation expressions
 * @param dataTableId - ID of the data table for metric creation
 * @returns Object with either a dimension field name or a metric object
 */
function parseEncodingAxis(
  value: string | undefined,
  parseAggregateExpression: (expr: string) => {
    aggregation: InsightMetric["aggregation"];
    columnName?: string;
  } | null,
  dataTableId: string,
): { dimension?: string; metric?: InsightMetric } {
  if (!value) return {};

  const parsed = parseAggregateExpression(value);
  if (parsed) {
    return {
      metric: {
        id: crypto.randomUUID() as UUID,
        name: value,
        sourceTable: dataTableId,
        columnName: parsed.columnName,
        aggregation: parsed.aggregation,
      },
    };
  }
  return { dimension: value };
}

/**
 * Process a full chart encoding to extract all dimensions and metrics.
 * Analyzes x, y, and color channels to separate raw fields from aggregations.
 *
 * @param encoding - The chart encoding with SQL expressions (ChartEncoding)
 * @param parseAggregateExpression - Function to parse aggregation expressions
 * @param dataTableId - ID of the data table for metric creation
 * @returns Object containing arrays of dimension field names and metric objects
 */
function parseChartEncoding(
  encoding: ChartEncoding,
  parseAggregateExpression: (expr: string) => {
    aggregation: InsightMetric["aggregation"];
    columnName?: string;
  } | null,
  dataTableId: string,
): ParsedEncoding {
  const dimensionFields: string[] = [];
  const metrics: InsightMetric[] = [];

  // Process X axis
  const xResult = parseEncodingAxis(
    encoding.x,
    parseAggregateExpression,
    dataTableId,
  );
  if (xResult.dimension) dimensionFields.push(xResult.dimension);
  if (xResult.metric) metrics.push(xResult.metric);

  // Process Y axis
  const yResult = parseEncodingAxis(
    encoding.y,
    parseAggregateExpression,
    dataTableId,
  );
  if (yResult.dimension) dimensionFields.push(yResult.dimension);
  if (yResult.metric) metrics.push(yResult.metric);

  // Process color (only as dimension)
  if (encoding.color) {
    const colorParsed = parseAggregateExpression(encoding.color);
    if (!colorParsed) {
      dimensionFields.push(encoding.color);
    }
  }

  return { dimensionFields, metrics };
}

/**
 * Merge new fields and metrics with existing insight fields, avoiding duplicates.
 * Field IDs are compared directly; metrics are compared by column name + aggregation.
 *
 * @param newFieldIds - Field IDs to add from the new visualization
 * @param newMetrics - Metrics to add from the new visualization
 * @param existingFieldIds - Current insight field IDs
 * @param existingMetrics - Current insight metrics
 * @returns Merged arrays with no duplicates
 */
function mergeFieldsAndMetrics(
  newFieldIds: UUID[],
  newMetrics: InsightMetric[],
  existingFieldIds: UUID[],
  existingMetrics: InsightMetric[],
): { mergedFieldIds: UUID[]; mergedMetrics: InsightMetric[] } {
  const mergedFieldIds = [
    ...existingFieldIds,
    ...newFieldIds.filter((id) => !existingFieldIds.includes(id)),
  ];

  const mergedMetrics = [...existingMetrics];
  for (const newMetric of newMetrics) {
    const isDuplicate = existingMetrics.some(
      (m) =>
        m.columnName === newMetric.columnName &&
        m.aggregation === newMetric.aggregation,
    );
    if (!isDuplicate) {
      mergedMetrics.push(newMetric);
    }
  }

  return { mergedFieldIds, mergedMetrics };
}

/**
 * Convert a ChartEncoding (SQL expressions) to VisualizationEncoding (prefixed IDs).
 *
 * This is the key conversion point between:
 * - ChartEncoding: Used for rendering (plain strings like "category" or "sum(revenue)")
 * - VisualizationEncoding: Used for persistence (prefixed IDs like "field:uuid" or "metric:uuid")
 *
 * @param chartEncoding - The chart encoding with SQL expressions
 * @param fieldIdMap - Map from column name to field ID
 * @param mergedMetrics - Metrics array (after merge) with their IDs
 * @param parseAggregateExpression - Function to detect if a string is an aggregation
 * @param suggestion - The full chart suggestion containing transforms
 */
function convertToVisualizationEncoding(
  chartEncoding: ChartEncoding,
  fieldIdMap: Map<string, UUID>,
  mergedMetrics: InsightMetric[],
  parseAggregateExpression: (expr: string) => {
    aggregation: InsightMetric["aggregation"];
    columnName?: string;
  } | null,
  suggestion?: ChartSuggestion,
): VisualizationEncoding {
  const result: VisualizationEncoding = {};

  // Helper to convert a single channel
  const convertChannel = (
    value: string | undefined,
  ):
    | ReturnType<typeof fieldEncoding>
    | ReturnType<typeof metricEncoding>
    | undefined => {
    if (!value) return undefined;

    // Check if it's an aggregation expression
    const parsed = parseAggregateExpression(value);
    if (parsed) {
      // It's a metric - find matching metric in mergedMetrics by aggregation + columnName
      const metric = mergedMetrics.find(
        (m) =>
          m.aggregation === parsed.aggregation &&
          m.columnName === parsed.columnName,
      );
      if (metric) {
        return metricEncoding(metric.id);
      }
      // Fallback: shouldn't happen if mergeFieldsAndMetrics was called first
      console.warn(
        `[convertToVisualizationEncoding] Metric not found for: ${value}`,
      );
      return undefined;
    }

    // It's a dimension field - find field ID by column name (looking through
    // date-transform wrappers, preserving repeat-join instance qualifiers)
    const fieldId = lookupEncodingFieldRef(fieldIdMap, value);
    if (fieldId) {
      return fieldEncoding(fieldId);
    }
    console.warn(
      `[convertToVisualizationEncoding] Field not found for: ${value}`,
    );
    return undefined;
  };

  result.x = convertChannel(chartEncoding.x);
  result.y = convertChannel(chartEncoding.y);
  result.color = convertChannel(chartEncoding.color);
  result.size = convertChannel(chartEncoding.size);
  result.xType = chartEncoding.xType;
  result.yType = chartEncoding.yType;

  // Copy date transforms from suggestion (for temporal axis aggregation)
  if (suggestion?.xTransform) {
    result.xTransform = suggestion.xTransform;
  }
  if (suggestion?.yTransform) {
    result.yTransform = suggestion.yTransform;
  }

  return result;
}

const CANVAS_CHART_TYPES: VisualizationType[] = [
  "barY",
  "barX",
  "line",
  "areaY",
  "dot",
  "hexbin",
  "heatmap",
  "raster",
];

function getCanvasViewKey(view: InsightCanvasView): string {
  if (view.kind === "chart") return `chart:${view.chartType}`;
  if (view.kind === "visualization")
    return `visualization:${view.visualizationId}`;
  return "table";
}

function chartView(chartType: VisualizationType): InsightCanvasView {
  return { kind: "chart", chartType };
}

function visualizationView(visualizationId: string): InsightCanvasView {
  return { kind: "visualization", visualizationId };
}

function getVisualizationEncodingSignature(
  encoding: VisualizationEncoding | undefined,
): string {
  if (!encoding) return "";
  return [
    encoding.x ?? "",
    encoding.y ?? "",
    encoding.color ?? "",
    encoding.size ?? "",
    encoding.xTransform ? JSON.stringify(encoding.xTransform) : "",
    encoding.yTransform ? JSON.stringify(encoding.yTransform) : "",
  ].join("|");
}

function InsightResultTable({ insight }: { insight: Insight }) {
  const {
    fetchData,
    totalCount,
    fieldCount,
    isReady,
    columnDisplayNames,
    columnTypeMap,
  } = useInsightPagination({
    insight,
    showModelPreview: false,
  });

  const columnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    return Object.entries(columnDisplayNames).map(([id, label]) => {
      const colType = columnTypeMap[id];
      return {
        id,
        label,
        format:
          colType !== undefined
            ? (value: unknown) => formatCellValue(value, colType)
            : undefined,
      };
    });
  }, [columnDisplayNames, columnTypeMap]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 px-4 text-sm text-neutral-fg-subtle">
        {isReady
          ? `${(totalCount || 0).toLocaleString()} rows • ${(fieldCount || 0).toLocaleString()} fields`
          : "Loading data..."}
      </div>
      <div className="min-h-0 flex-1 px-4 pb-4">
        {/* Mount only when the pagination hook is ready (per its contract):
            mounting earlier lets the initial fetch race the hook's own
            init-driven fetchData identity changes. */}
        {isReady && (
          <VirtualTable
            onFetchData={fetchData}
            columnConfigs={columnConfigs}
            height={520}
            compact
          />
        )}
      </div>
    </div>
  );
}

function CanvasViewButton({
  active,
  muted = false,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  muted?: boolean;
  icon: ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <ControlTooltip label={label} description={description} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "flex h-8 max-w-44 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
          "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
          active
            ? "bg-neutral-bg-emphasis text-neutral-fg shadow-sm"
            : "text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg",
          muted && !active && "opacity-60",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    </ControlTooltip>
  );
}

function EphemeralChartCanvas({
  tableName,
  suggestion,
  isLoading,
  onRegenerate,
}: {
  tableName?: string;
  suggestion?: ChartSuggestion;
  isLoading: boolean;
  onRegenerate: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-fg-subtle">
        Loading chart view...
      </div>
    );
  }

  if (!tableName || !suggestion) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-neutral-fg-subtle">
        <p>This chart view needs usable fields.</p>
        <Button
          size="sm"
          variant="outline"
          icon={SparklesIcon}
          label="Try another suggestion"
          onClick={onRegenerate}
        />
      </div>
    );
  }

  return (
    <div className="h-full px-4 pb-4">
      <Chart
        tableName={tableName}
        visualizationType={suggestion.chartType}
        encoding={suggestion.encoding}
        height={520}
        className="h-full w-full"
      />
    </div>
  );
}

/**
 * InsightView - Unified view for insight page
 *
 * Single-page layout (no tabs) with modular sections:
 * - Data sources
 * - Data preview
 * - Configuration (fields, metrics)
 * - Chart suggestions
 * - Visualizations
 *
 * Performance optimizations:
 * - Local state for insight name with debounced updates
 * - Sections only re-render when their specific data changes
 */
export function InsightView({
  insight,
  visualizeIntent = false,
}: InsightViewProps) {
  const insightId = insight.id;
  const navigate = useNavigate();

  // Local state for insight name (prevents re-renders on typing)
  const [localName, setLocalName] = useState(insight.name);
  const prevInsightNameRef = useRef(insight.name);
  // Sync local name when insight prop changes from an external source.
  useEffect(() => {
    if (prevInsightNameRef.current !== insight.name) {
      prevInsightNameRef.current = insight.name;
      setLocalName(insight.name);
    }
  }, [insight.name]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const [suggestionSeed, setSuggestionSeed] = useState(0);
  const [visualModeRequestedFor, setVisualModeRequestedFor] = useState<
    string | null
  >(null);

  // Mutations — artifact writes go through commitBatch (one batch per user edit).
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);
  const createVisualizationLocal = useCallback(
    async (input: Omit<CommandPayloads["CreateVisualization"], "id">) => {
      const id = crypto.randomUUID() as UUID;
      await commitBatch({
        commands: [cmd("CreateVisualization", { id, ...input })],
      });
      return { id };
    },
    [commitBatch],
  );
  const removeVisualizationMutation = useCallback(
    ({ id }: { id: string }) =>
      commitBatch({ commands: [cmd("DeleteNode", { id: id as UUID })] }),
    [commitBatch],
  );
  const { confirm } = useConfirmDialogStore();

  // Debounced save for insight name (500ms after typing stops)
  const handleNameChange = useCallback(
    (newName: string) => {
      setLocalName(newName);

      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout to save after 500ms of no typing
      saveTimeoutRef.current = setTimeout(() => {
        if (newName !== insight.name) {
          // Fire-and-forget from a debounce: surface a failure but leave the
          // field on the user's latest input. We deliberately don't roll the
          // field back — with overlapping debounced renames a rollback would
          // race (clobbering newer input, or restoring a pre-edit name over a
          // partial success); the next keystroke's debounce simply retries.
          commitBatch({
            commands: [cmd("RenameNode", { id: insightId, name: newName })],
          }).catch(() => toast.error("Couldn't rename the insight"));
        }
      }, 500);
    },
    [insightId, insight.name, commitBatch],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Fetch related data
  const { data: allDataTables = [] } = useQuery(api.listDataTables, {
    args: {},
  });
  const { data: allVisualizations = [] } = useQuery(api.listVisualizations, {
    args: {},
  });
  const { data: dashboards = [] } = useQuery(api.listDashboards);
  const persistedActiveView = useInsightCanvasStore(
    (s) => s.activeViewByInsight[insightId],
  );
  const setPersistedActiveView = useInsightCanvasStore((s) => s.setActiveView);

  // Find data table
  const dataTable = useMemo(
    () => allDataTables.find((t) => t.id === insight.baseTableId),
    [allDataTables, insight.baseTableId],
  );

  // Get DuckDB view/table name for chart rendering
  // For insights with joins, creates a view with joined data
  // For simple insights, returns the base table name
  const { isReady: isChartViewReady } = useInsightView(insight);
  const chartSuggestionInsight = useMemo(
    () => buildChartSuggestionInsight(insight),
    [insight],
  );
  const {
    dataFrameId: chartSuggestionFrameId,
    isReady: areChartSuggestionsReady,
    schema: chartSuggestionSchema,
    sampleRows: chartSuggestionRows,
    totalCount: chartSuggestionRowCount,
  } = useInsightPagination({
    insight: chartSuggestionInsight,
    showModelPreview: true,
  });
  const columnAnalysis = useMemo<ColumnAnalysis[]>(
    () =>
      areChartSuggestionsReady
        ? analyzeFrameSample(
            chartSuggestionSchema,
            chartSuggestionRows,
            chartSuggestionRowCount,
          )
        : [],
    [
      areChartSuggestionsReady,
      chartSuggestionRowCount,
      chartSuggestionRows,
      chartSuggestionSchema,
    ],
  );

  // Get visualizations for this insight
  const insightVisualizations = useMemo(
    () => allVisualizations.filter((v) => v.insightId === insightId),
    [allVisualizations, insightId],
  );
  const pinnedVisualizationIds = useMemo(
    () => new Set(insightVisualizations.map((viz) => viz.id)),
    [insightVisualizations],
  );
  const activeView = useMemo(
    () =>
      sanitizeInsightCanvasView(persistedActiveView, pinnedVisualizationIds),
    [persistedActiveView, pinnedVisualizationIds],
  );
  const activeVisualization =
    activeView.kind === "visualization"
      ? insightVisualizations.find(
          (viz) => viz.id === activeView.visualizationId,
        )
      : undefined;

  // No write-back of the sanitized view into the store: right after a pin,
  // the persisted selection can reference a visualization the list hasn't
  // loaded yet — persisting the table fallback would clobber that intent.
  // Read-time sanitization above is enough; the view self-heals on load.

  const handleSetActiveView = useCallback(
    (view: InsightCanvasView) => {
      setPersistedActiveView(insightId, view);
    },
    [insightId, setPersistedActiveView],
  );

  // Build field map for suggestions
  // Key by field ID to match enrichColumnAnalysis lookup in suggest-charts.ts
  // Includes fields from both base table AND joined tables
  const fieldMap = useMemo<Record<string, Field>>(() => {
    if (!dataTable) return {};
    const map: Record<string, Field> = {};

    // Add base table fields (keyed by field ID)
    (dataTable.fields ?? [])
      .filter((f) => !f.name.startsWith("_"))
      .forEach((f) => {
        map[f.id] = f;
      });

    // Add fields from joined tables (keyed by field ID)
    insight.joins?.forEach((join) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      if (joinTable) {
        (joinTable.fields ?? [])
          .filter((f) => !f.name.startsWith("_"))
          .forEach((f) => {
            // Don't overwrite if field ID already exists (base table takes precedence)
            if (!map[f.id]) {
              map[f.id] = f;
            }
          });
      }
    });

    return map;
  }, [dataTable, insight.joins, allDataTables]);

  // Get existing field and metric column names from insight configuration
  // Includes fields from both base table AND joined tables
  const existingFieldNames = useMemo(() => {
    if (!dataTable) return [];

    const names: string[] = [];

    // Map selected field IDs to column names (includes base + joined tables)
    const fieldIdToName = new Map<string, string>();
    (dataTable.fields ?? []).forEach((f) => {
      fieldIdToName.set(f.id, f.columnName ?? f.name);
    });

    // Add joined table fields to the mapping
    insight.joins?.forEach((join) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      if (joinTable) {
        (joinTable.fields ?? []).forEach((f) => {
          fieldIdToName.set(f.id, f.columnName ?? f.name);
        });
      }
    });

    (insight.selectedFields ?? []).forEach((id) => {
      const name = fieldIdToName.get(id);
      if (name) names.push(name);
    });

    // Also include metric column names (the underlying column, not the aggregation)
    (insight.metrics ?? []).forEach((metric) => {
      if (metric.columnName) {
        names.push(metric.columnName);
      }
    });

    return names;
  }, [
    dataTable,
    insight.selectedFields,
    insight.metrics,
    insight.joins,
    allDataTables,
  ]);

  // Create minimal insight object for suggestions
  // Uses LocalInsight type from stores which is expected by suggestCharts
  const insightForSuggestions = useMemo<LocalInsight | null>(() => {
    if (!dataTable) return null;
    return {
      id: insightId,
      name: insight.name,
      baseTable: {
        tableId: dataTable.id,
        selectedFields: [],
      },
      metrics: [],
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt ?? insight.createdAt,
    };
  }, [
    insightId,
    insight.name,
    insight.createdAt,
    insight.updatedAt,
    dataTable,
  ]);

  const chartSuggestionsByType = useMemo(() => {
    const suggestions = new Map<VisualizationType, ChartSuggestion>();
    if (
      !insightForSuggestions ||
      columnAnalysis.length === 0 ||
      chartSuggestionRowCount === 0
    ) {
      return suggestions;
    }

    for (const chartType of CANVAS_CHART_TYPES) {
      const suggestion = suggestByChartType(
        insightForSuggestions,
        columnAnalysis,
        chartSuggestionRowCount,
        fieldMap,
        chartType,
        { existingFields: existingFieldNames, seed: suggestionSeed },
      );
      if (suggestion) {
        suggestions.set(chartType, suggestion);
      }
    }
    return suggestions;
  }, [
    insightForSuggestions,
    columnAnalysis,
    chartSuggestionRowCount,
    fieldMap,
    existingFieldNames,
    suggestionSeed,
  ]);

  const firstChartSuggestion = useMemo(() => {
    for (const chartType of CANVAS_CHART_TYPES) {
      const suggestion = chartSuggestionsByType.get(chartType);
      if (suggestion) return suggestion;
    }
    return null;
  }, [chartSuggestionsByType]);

  const activeChartSuggestion =
    activeView.kind === "chart"
      ? chartSuggestionsByType.get(activeView.chartType)
      : undefined;

  // Parse aggregate expression like "sum(amount)" → { aggregation: "sum", columnName: "amount" }
  const parseAggregateExpression = useCallback(
    (
      expr: string,
    ): {
      aggregation: InsightMetric["aggregation"];
      columnName: string;
    } | null => {
      const match = expr.match(
        /^(sum|avg|count|min|max|count_distinct)\(([^)]+)\)$/i,
      );
      if (match?.[1] && match[2]) {
        return {
          aggregation: match[1].toLowerCase() as InsightMetric["aggregation"],
          columnName: match[2],
        };
      }
      return null;
    },
    [],
  );

  const pinChartSuggestion = useCallback(
    async (suggestion: ChartSuggestion): Promise<UUID | null> => {
      if (!dataTable?.dataFrameId || !isChartViewReady) return null;

      // Parse encoding to extract dimensions and metrics
      const { dimensionFields, metrics } = parseChartEncoding(
        suggestion.encoding,
        parseAggregateExpression,
        dataTable.id,
      );

      // Map dimension column names to field IDs (base table + joined tables)
      // Supports both original column names AND UUID-based aliases (field_<uuid>)
      // because suggestions use UUID aliases but we need to look up field IDs
      const fieldIdMap = new Map<string, UUID>();

      // Base table fields - add both original name and UUID alias
      (dataTable.fields ?? []).forEach((f) => {
        fieldIdMap.set(f.columnName ?? f.name, f.id);
        // Also add UUID-based alias (field_<uuid>) for suggestion encoding lookups
        fieldIdMap.set(fieldIdToColumnAlias(f.id), f.id);
      });

      // Joined table fields - add both original name and UUID alias
      insight.joins?.forEach((join) => {
        const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
        if (joinTable) {
          (joinTable.fields ?? []).forEach((f) => {
            const key = f.columnName ?? f.name;
            // Don't overwrite if column already exists (base table takes precedence)
            if (!fieldIdMap.has(key)) {
              fieldIdMap.set(key, f.id);
            }
            // Always add UUID alias (no collision risk with these unique keys)
            fieldIdMap.set(fieldIdToColumnAlias(f.id), f.id);
          });
        }
      });

      // Convert dimension column names to field IDs
      const newSelectedFieldIds = dimensionFields
        .map((colName) => lookupEncodingFieldId(fieldIdMap, colName))
        .filter((id): id is UUID => id !== undefined);

      // Suggestion encodings reference UUID column aliases, so metrics parsed
      // from them carry names like "sum(field_<uuid>)". Rename to the field's
      // display name for the Metrics panel; columnName stays untouched (it
      // drives SQL generation and encoding matching).
      const fieldNameById = new Map<UUID, string>();
      (dataTable.fields ?? []).forEach((f) => fieldNameById.set(f.id, f.name));
      insight.joins?.forEach((join) => {
        const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
        (joinTable?.fields ?? []).forEach((f) =>
          fieldNameById.set(f.id, f.name),
        );
      });
      const namedMetrics = metrics.map((metric) => {
        if (!metric.columnName) return metric;
        const fieldId = lookupEncodingFieldId(fieldIdMap, metric.columnName);
        const fieldName = fieldId ? fieldNameById.get(fieldId) : undefined;
        return fieldName
          ? { ...metric, name: `${metric.aggregation}(${fieldName})` }
          : metric;
      });

      // Merge with existing insight fields/metrics
      const { mergedFieldIds, mergedMetrics } = mergeFieldsAndMetrics(
        newSelectedFieldIds,
        namedMetrics,
        insight.selectedFields ?? [],
        insight.metrics ?? [],
      );

      // Update insight with merged fields and metrics.
      // Must await: fields and metrics have to be saved before navigation.
      // An empty batch means the merge changed nothing — skip the round trip
      // rather than sending a batch with no commands in it.
      // Failures propagate: all three callers of pinChartSuggestion catch and
      // toast, so a toast here would show the user two of them.
      const insightCommands = buildInsightUpdateCommands(insightId, insight, {
        selectedFields: mergedFieldIds,
        metrics: mergedMetrics,
      });
      if (insightCommands.length > 0) {
        await commitBatch({ commands: insightCommands });
      }

      // Convert ChartEncoding (SQL expressions) to VisualizationEncoding (prefixed IDs)
      // Pass the full suggestion to preserve xTransform/yTransform for temporal axes
      const visualizationEncoding = convertToVisualizationEncoding(
        suggestion.encoding,
        fieldIdMap,
        mergedMetrics,
        parseAggregateExpression,
        suggestion,
      );

      // Create visualization using encoding-driven rendering
      const matchingVisualization = insightVisualizations.find(
        (viz) =>
          viz.visualizationType === suggestion.chartType &&
          getVisualizationEncodingSignature(viz.encoding) ===
            getVisualizationEncodingSignature(visualizationEncoding),
      );

      if (matchingVisualization) {
        handleSetActiveView(visualizationView(matchingVisualization.id));
        return matchingVisualization.id;
      }

      const { id: vizId } = await createVisualizationLocal({
        name: suggestion.title,
        insightId,
        visualizationType: suggestion.chartType,
        spec: {} as VegaLiteSpec, // Deprecated: rendering now uses encoding
        encoding: visualizationEncoding,
      });

      handleSetActiveView(visualizationView(vizId));
      return vizId;
    },
    [
      dataTable,
      allDataTables,
      isChartViewReady,
      parseAggregateExpression,
      insight,
      commitBatch,
      insightId,
      createVisualizationLocal,
      insightVisualizations,
      handleSetActiveView,
    ],
  );

  // Handle regenerating suggestions with a different seed
  const handleRegenerate = useCallback(() => {
    setSuggestionSeed((prev) => prev + 1);
  }, []);

  const autoPinAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !canAttemptVisualizeIntent({
        visualizeIntent,
        alreadyAttempted: autoPinAttemptRef.current === insightId,
        hasVisualization: insightVisualizations.length > 0,
        hasSuggestion: firstChartSuggestion !== null,
        hasDataFrame: Boolean(dataTable?.dataFrameId),
        isChartViewReady,
      })
    ) {
      return;
    }
    if (!firstChartSuggestion) return;

    autoPinAttemptRef.current = insightId;
    pinChartSuggestion(firstChartSuggestion).catch((error) => {
      console.error("[InsightView] Auto-save failed:", error);
      toast.error("Couldn't save the chart");
    });
  }, [
    firstChartSuggestion,
    dataTable?.dataFrameId,
    insightId,
    insightVisualizations.length,
    isChartViewReady,
    pinChartSuggestion,
    visualizeIntent,
  ]);

  const handlePinActiveChart = useCallback(async () => {
    if (!activeChartSuggestion) return;
    try {
      await pinChartSuggestion(activeChartSuggestion);
      toast.success("Chart saved");
    } catch (error) {
      console.error("[InsightView] Save failed:", error);
      toast.error("Couldn't save the chart");
    }
  }, [activeChartSuggestion, pinChartSuggestion]);

  const ensureActiveVisualization =
    useCallback(async (): Promise<UUID | null> => {
      if (activeView.kind === "visualization")
        return activeView.visualizationId;
      if (activeView.kind === "chart" && activeChartSuggestion) {
        return pinChartSuggestion(activeChartSuggestion);
      }
      return null;
    }, [activeChartSuggestion, activeView, pinChartSuggestion]);

  const handleAddActiveViewToDashboard = useCallback(async () => {
    try {
      const visualizationId = await ensureActiveVisualization();
      if (!visualizationId) return;

      const dashboard = dashboards[0];
      const dashboardId = dashboard?.id ?? (crypto.randomUUID() as UUID);
      const bottomY =
        dashboard?.items.reduce(
          (max, item) => Math.max(max, item.y + item.height),
          0,
        ) ?? 0;

      await commitBatch({
        commands: [
          ...(dashboard
            ? []
            : [
                cmd("CreateDashboard", {
                  id: dashboardId,
                  name: `${insight.name} dashboard`,
                }),
              ]),
          cmd("AddDashboardItem", {
            dashboardId,
            item: {
              id: crypto.randomUUID() as UUID,
              type: "visualization",
              visualizationId,
              x: 0,
              y: bottomY,
              width: 6,
              height: 6,
            },
          }),
        ],
      });
      toast.success("Added to dashboard");
    } catch (error) {
      console.error("[InsightView] Add to dashboard failed:", error);
      toast.error("Couldn't add to dashboard");
    }
  }, [commitBatch, dashboards, ensureActiveVisualization, insight.name]);

  // Handle duplicating a visualization
  const handleDuplicateVisualization = useCallback(
    async (vizId: string) => {
      const viz = insightVisualizations.find((v) => v.id === vizId);
      if (!viz) return;

      const { id: newVizId } = await createVisualizationLocal({
        name: `${viz.name} (copy)`,
        insightId,
        visualizationType: viz.visualizationType,
        spec: viz.spec,
        encoding: viz.encoding,
      });

      navigate({ to: `/visualizations/${newVizId}` } as never);
    },
    [insightVisualizations, createVisualizationLocal, insightId, navigate],
  );

  // Handle deleting a visualization
  const handleDeleteVisualization = useCallback(
    (vizId: string, name: string) => {
      requestSavedVisualizationDeletion(
        confirm,
        removeVisualizationMutation,
        vizId,
        name,
      );
    },
    [confirm, removeVisualizationMutation],
  );

  const handleSelectVisualMode = useCallback(() => {
    if (activeView.kind !== "table") return;
    const target = resolveVisualModeTarget({
      firstPinnedVisualizationId: insightVisualizations[0]?.id,
      suggestionsReady: areChartSuggestionsReady,
      firstSuggestedChartType: firstChartSuggestion?.chartType,
    });
    if (target) handleSetActiveView(target);
    else setVisualModeRequestedFor(insightId);
  }, [
    activeView.kind,
    areChartSuggestionsReady,
    firstChartSuggestion,
    handleSetActiveView,
    insightId,
    insightVisualizations,
  ]);

  useEffect(() => {
    if (activeView.kind !== "table") return;
    const requestedForCurrentInsight = visualModeRequestedFor === insightId;
    const target = resolvePendingVisualModeTarget({
      requestedInsightId: visualModeRequestedFor,
      currentInsightId: insightId,
      firstPinnedVisualizationId: insightVisualizations[0]?.id,
      suggestionsReady: areChartSuggestionsReady,
      firstSuggestedChartType: firstChartSuggestion?.chartType,
    });
    if (!target && !(requestedForCurrentInsight && areChartSuggestionsReady))
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setVisualModeRequestedFor(null);
      if (target) handleSetActiveView(target);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeView.kind,
    areChartSuggestionsReady,
    firstChartSuggestion,
    handleSetActiveView,
    insightId,
    insightVisualizations,
    visualModeRequestedFor,
  ]);

  let activeViewLabel = "Data result";
  if (activeView.kind === "chart") {
    activeViewLabel = CHART_TYPE_METADATA[activeView.chartType].displayName;
  } else if (activeView.kind === "visualization") {
    activeViewLabel = activeVisualization?.name ?? "Saved chart";
  }
  let activeViewDescription = "Rows produced by the current data model";
  if (activeView.kind === "chart") {
    activeViewDescription = "Chart preview — changes are not saved";
  } else if (activeView.kind === "visualization") {
    activeViewDescription = "Saved chart — reusable in dashboards";
  }
  const canPinActiveChart =
    activeView.kind === "chart" && activeChartSuggestion !== undefined;
  const canAddActiveViewToDashboard =
    activeView.kind === "visualization" ||
    (activeView.kind === "chart" && activeChartSuggestion !== undefined);

  // Data table not found - check after all hooks are called
  if (!dataTable) {
    return <NotFoundView type="dataTable" />;
  }

  return (
    <AppLayout
      breadcrumbs={[
        { label: "Insights", to: "/insights" },
        { label: localName || "Untitled" },
      ]}
      leftPanel={
        <InsightConfigPanel
          insight={insight}
          dataTable={dataTable}
          allDataTables={allDataTables}
          name={localName}
          onNameChange={handleNameChange}
        />
      }
    >
      <div className="container mx-auto flex h-full max-w-7xl flex-col gap-4 px-6 py-6">
        <section className="flex min-h-[620px] flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg/90 shadow-[var(--surface-shadow)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex shrink-0 rounded-lg bg-neutral-bg-muted p-1">
                <CanvasViewButton
                  active={activeView.kind === "table"}
                  icon={<TableIcon className="h-3.5 w-3.5" />}
                  label="Data"
                  description="View the rows produced by the current data model."
                  onClick={() => {
                    setVisualModeRequestedFor(null);
                    handleSetActiveView(TABLE_CANVAS_VIEW);
                  }}
                />
                <CanvasViewButton
                  active={activeView.kind !== "table"}
                  icon={<SparklesIcon className="h-3.5 w-3.5" />}
                  label="Visualize"
                  description="Explore chart types before saving a chart."
                  onClick={handleSelectVisualMode}
                />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-neutral-fg">
                  {activeViewLabel}
                </h2>
                <p className="truncate text-xs text-neutral-fg-subtle">
                  {activeViewDescription}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canPinActiveChart && (
                <ControlTooltip
                  label="Save chart"
                  description="Keep this chart as a reusable view for dashboards."
                >
                  <Button
                    size="sm"
                    variant="outline"
                    icon={PlusIcon}
                    label="Save chart"
                    onClick={handlePinActiveChart}
                  />
                </ControlTooltip>
              )}
              <Button
                size="sm"
                variant="outline"
                icon={DashboardIcon}
                label="Add to dashboard"
                onClick={handleAddActiveViewToDashboard}
                disabled={!canAddActiveViewToDashboard}
              />
              {activeView.kind === "visualization" && activeVisualization && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Duplicate"
                    onClick={() =>
                      handleDuplicateVisualization(activeVisualization.id)
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    color="danger"
                    label="Delete"
                    onClick={() =>
                      handleDeleteVisualization(
                        activeVisualization.id,
                        activeVisualization.name,
                      )
                    }
                  />
                </>
              )}
            </div>
          </div>

          {activeView.kind !== "table" && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-neutral-border/50 px-4 py-3">
              <span className="mr-1 text-xs font-medium text-neutral-fg-subtle">
                Chart
              </span>
              {CANVAS_CHART_TYPES.map((chartType) => {
                const ChartIcon = CHART_ICONS[chartType];
                const chartAvailable = chartSuggestionsByType.has(chartType);
                const view = chartView(chartType);
                return (
                  <CanvasViewButton
                    key={getCanvasViewKey(view)}
                    active={canvasViewsEqual(activeView, view)}
                    muted={!chartAvailable}
                    icon={<ChartIcon size={14} />}
                    label={CHART_TYPE_METADATA[chartType].displayName}
                    description={
                      chartAvailable
                        ? CHART_TYPE_METADATA[chartType].description
                        : "No suitable fields are available for this chart type."
                    }
                    onClick={() => handleSetActiveView(view)}
                  />
                );
              })}
              {insightVisualizations.length > 0 && (
                <span className="ml-2 border-l border-neutral-border/60 pl-3 text-xs font-medium text-neutral-fg-subtle">
                  Saved
                </span>
              )}
              {insightVisualizations.map((visualization) => {
                const view = visualizationView(visualization.id);
                const ChartIcon = CHART_ICONS[visualization.visualizationType];
                return (
                  <CanvasViewButton
                    key={getCanvasViewKey(view)}
                    active={canvasViewsEqual(activeView, view)}
                    icon={<ChartIcon size={14} />}
                    label={visualization.name}
                    description="Saved chart — reusable in dashboards."
                    onClick={() => handleSetActiveView(view)}
                  />
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {activeView.kind === "table" && (
              <InsightResultTable insight={insight} />
            )}
            {activeView.kind === "chart" && (
              <EphemeralChartCanvas
                tableName={chartSuggestionFrameId ?? undefined}
                suggestion={activeChartSuggestion}
                isLoading={!areChartSuggestionsReady}
                onRegenerate={handleRegenerate}
              />
            )}
            {activeView.kind === "visualization" && activeVisualization && (
              <div className="h-full px-4 pb-4">
                <VisualizationPreview
                  visualization={activeVisualization}
                  height={520}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
