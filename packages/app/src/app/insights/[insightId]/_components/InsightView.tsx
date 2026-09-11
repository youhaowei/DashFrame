import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { AppLayout } from "@/components/layouts/AppLayout";
import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { visualizationDetailLink } from "@/components/visualizations/visualization-navigation";
import {
  resolveInsightSourceDataTable,
  useInsightPagination,
} from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import { formatCellValue } from "@/lib/cell-formatter";
import { resolveInsightAuthoringTable } from "@/lib/insights/compute-combined-fields";
import {
  useConfirmDialogStore,
  type ConfirmDialogConfig,
} from "@/lib/stores/confirm-dialog-store";
import {
  sanitizeInsightCanvasView,
  TABLE_CANVAS_VIEW,
  useInsightCanvasStore,
  type InsightCanvasView,
} from "@/lib/stores/insight-canvas-store";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import type { Insight as LocalInsight } from "@/lib/stores/types";
import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import {
  suggestByChartType,
  type ChartSuggestion,
} from "@/lib/visualizations/suggest-charts";
import { api } from "@dashframe/convex-backend/api";
import {
  extractUUIDFromColumnAlias,
  fieldIdToColumnAlias,
  isGeneratedColumnLabel,
} from "@dashframe/engine";
import type {
  ChartEncoding,
  ColumnAnalysis,
  CompiledInsight,
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
  buildVisualizationUpdateCommands,
  cmd,
  fieldEncoding,
  metricEncoding,
} from "@dashframe/types";
import {
  ControlTooltip,
  VirtualTable,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
import { Chart } from "@dashframe/visualization";
import { Link, useNavigate } from "@tanstack/react-router";

import {
  Button,
  ButtonPrimitive,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import {
  DashboardIcon,
  MoreIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
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
import {
  INSIGHT_CANVAS_CHART_TYPES,
  VisualizationConfigPanel,
} from "./VisualizationConfigPanel";

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

export type AddToReportTarget<T> =
  | { kind: "pending" }
  | { kind: "query-error" }
  | { kind: "missing-report" }
  | { kind: "ready"; dashboard: T | undefined };

export function resolveAddToReportTarget<
  T extends { id: string; items: readonly { y: number; height: number }[] },
>(input: {
  reportId?: string;
  dashboards: readonly T[] | undefined;
  isPending: boolean;
  isError: boolean;
}): AddToReportTarget<T> {
  if (input.isPending) return { kind: "pending" };
  if (input.isError) return { kind: "query-error" };
  if (input.reportId) {
    const dashboard = (input.dashboards ?? []).find(
      (candidate) => candidate.id === input.reportId,
    );
    if (!dashboard) return { kind: "missing-report" };
    return { kind: "ready", dashboard };
  }
  return { kind: "ready", dashboard: input.dashboards?.[0] };
}

interface InsightViewProps {
  insight: Insight;
  visualizeIntent?: boolean;
  reportId?: string;
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
 * Resolve an encoding channel value to a canonical field ID. Tries, in order:
 * the raw value, the value with date-transform wrappers removed, and finally
 * the canonical UUID behind an instance-qualified repeat-join alias
 * (field_<uuid>_jN). Use this only for canonical field metadata lookups; a
 * persisted selectedFields reference must preserve its repeat-join instance.
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
 * VisualizationEncoding values and persisted Insight selectedFields.
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

export function resolveSuggestionDimensionFieldIds(
  fieldIdMap: Map<string, UUID>,
  dimensionFields: string[],
): UUID[] {
  return dimensionFields
    .map((columnName) => lookupEncodingFieldRef(fieldIdMap, columnName))
    .filter((id): id is UUID => id !== undefined);
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
export function parseChartEncoding(
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

function resolveMetricFieldRef(
  metric: InsightMetric,
  identityFields: Field[],
  fieldIdMap: Map<string, UUID>,
): UUID | undefined {
  if (!metric.columnName) return undefined;

  const columnName = unwrapEncodingExpression(metric.columnName);
  if (extractUUIDFromColumnAlias(columnName)) {
    return lookupEncodingFieldRef(fieldIdMap, columnName);
  }

  return identityFields.find(
    (field) =>
      field.tableId === metric.sourceTable &&
      (field.columnName ?? field.name) === columnName,
  )?.id;
}

function metricsShareIdentity(
  left: InsightMetric,
  right: InsightMetric,
  identityFields: Field[],
  fieldIdMap: Map<string, UUID>,
): boolean {
  if (left.aggregation !== right.aggregation) return false;

  const leftFieldRef = resolveMetricFieldRef(left, identityFields, fieldIdMap);
  const rightFieldRef = resolveMetricFieldRef(
    right,
    identityFields,
    fieldIdMap,
  );
  if (leftFieldRef && rightFieldRef) return leftFieldRef === rightFieldRef;
  if (leftFieldRef || rightFieldRef) return false;

  return (
    left.sourceTable === right.sourceTable &&
    left.columnName === right.columnName
  );
}

/**
 * Merge new fields and metrics with existing insight fields, avoiding duplicates.
 * Field IDs are compared directly; metric columns resolve to field IDs before
 * aggregation and field identity are compared.
 *
 * @param newFieldIds - Field IDs to add from the new visualization
 * @param newMetrics - Metrics to add from the new visualization
 * @param existingFieldIds - Current insight field IDs
 * @param existingMetrics - Current insight metrics
 * @returns Merged arrays with no duplicates
 */
export function mergeFieldsAndMetrics(
  newFieldIds: UUID[],
  newMetrics: InsightMetric[],
  existingFieldIds: UUID[],
  existingMetrics: InsightMetric[],
  identityFields: Field[],
  fieldIdMap: Map<string, UUID>,
): { mergedFieldIds: UUID[]; mergedMetrics: InsightMetric[] } {
  const mergedFieldIds = [
    ...existingFieldIds,
    ...newFieldIds.filter((id) => !existingFieldIds.includes(id)),
  ];

  const mergedMetrics = [...existingMetrics];
  for (const newMetric of newMetrics) {
    const isDuplicate = existingMetrics.some((metric) =>
      metricsShareIdentity(metric, newMetric, identityFields, fieldIdMap),
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
  identityFields: Field[],
  metricSourceTable: UUID,
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
      const parsedMetric: InsightMetric = {
        id: "" as UUID,
        name: value,
        sourceTable: metricSourceTable,
        columnName: parsed.columnName,
        aggregation: parsed.aggregation,
      };
      const metric = mergedMetrics.find((candidate) =>
        metricsShareIdentity(
          candidate,
          parsedMetric,
          identityFields,
          fieldIdMap,
        ),
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

function chartView(chartType: VisualizationType): InsightCanvasView {
  return { kind: "chart", chartType };
}

function visualizationView(visualizationId: string): InsightCanvasView {
  return { kind: "visualization", visualizationId };
}

function resolveVisualizationPaneState(
  activeView: InsightCanvasView,
  activeVisualizationType: VisualizationType | undefined,
  paneOpen: boolean,
) {
  const available = activeView.kind !== "table";
  return {
    available,
    attached: available && paneOpen,
    chartType:
      activeView.kind === "chart"
        ? activeView.chartType
        : (activeVisualizationType ?? "barY"),
  };
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

function InsightResultTable({
  insight,
  collapsed = false,
  onToggleCollapsed,
  className,
}: {
  insight: Insight;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
}) {
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

  const summary = isReady
    ? `${(totalCount || 0).toLocaleString()} rows • ${(fieldCount || 0).toLocaleString()} fields`
    : "Loading data...";

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-8 shrink-0 items-center justify-between gap-3 px-2 text-xs text-neutral-fg-subtle">
        <span className="truncate">{summary}</span>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show result table" : "Hide result table"}
            className="shrink-0 rounded-sm px-1 underline-offset-2 transition-colors hover:text-neutral-fg hover:underline focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        )}
      </div>
      <div
        className={cn(
          "relative min-h-0 flex-1 transition-opacity duration-300 motion-reduce:transition-none",
          collapsed && "opacity-0",
        )}
        inert={collapsed}
        aria-hidden={collapsed}
      >
        {/* Mount only when the pagination hook is ready (per its contract):
              mounting earlier lets the initial fetch race the hook's own
              init-driven fetchData identity changes. */}
        {isReady && (
          <div className="absolute inset-0">
            <VirtualTable
              onFetchData={fetchData}
              columnConfigs={columnConfigs}
              height="100%"
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasViewButton({
  active,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
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
          "flex h-7 max-w-44 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors",
          "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
          active
            ? "bg-neutral-bg text-neutral-fg shadow-sm"
            : "text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate @max-3xl:sr-only">{label}</span>
      </button>
    </ControlTooltip>
  );
}

function getViewStatus(
  view: InsightCanvasView,
  savedChartName: string | undefined,
): string | undefined {
  if (view.kind === "chart") return "Preview, not saved";
  if (view.kind === "visualization") return savedChartName;
  return undefined;
}

function InsightMoreActionsMenu({
  onInspectDataFrames,
  savedChart,
  onDuplicateChart,
  onDeleteChart,
}: {
  onInspectDataFrames: () => void;
  savedChart?: { id: UUID; name: string };
  onDuplicateChart: (id: UUID) => void;
  onDeleteChart: (id: UUID, name: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ButtonPrimitive
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More actions"
            title="More actions"
            className="h-8 w-8 shrink-0"
          >
            <MoreIcon aria-hidden />
          </ButtonPrimitive>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onInspectDataFrames}>
          Inspect data frames
        </DropdownMenuItem>
        {savedChart && (
          <>
            <DropdownMenuItem onClick={() => onDuplicateChart(savedChart.id)}>
              Duplicate chart
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-palette-danger"
              onClick={() => onDeleteChart(savedChart.id, savedChart.name)}
            >
              Delete chart
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sunken well for the work canvas. Chart views lift the chart onto a raised
 * card above the result table; the data view shows the table alone.
 */
function InsightCanvasWell({
  insight,
  showChart,
  children,
}: {
  insight: Insight;
  showChart: boolean;
  children: ReactNode;
}) {
  const [resultCollapsed, setResultCollapsed] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg-muted p-2 shadow-inner dark:bg-neutral-bg-dim">
      {showChart ? (
        <>
          <div className="min-h-0 flex-[1_1_68%] overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg p-3 shadow-[var(--surface-shadow)] dark:bg-neutral-bg-subtle">
            {children}
          </div>
          <InsightResultTable
            insight={insight}
            collapsed={resultCollapsed}
            onToggleCollapsed={() =>
              setResultCollapsed((collapsed) => !collapsed)
            }
            // The strip stays visible while the body fades out and its space shrinks.
            className={cn(
              "overflow-hidden pt-1 transition-[flex-grow,flex-basis] duration-300 ease-out motion-reduce:transition-none",
              resultCollapsed ? "flex-[0_0_2.25rem]" : "flex-[1_1_32%]",
            )}
          />
        </>
      ) : (
        <InsightResultTable insight={insight} className="flex-1" />
      )}
    </div>
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
    <Chart
      tableName={tableName}
      visualizationType={suggestion.chartType}
      encoding={suggestion.encoding}
      height="container"
      className="h-full w-full"
    />
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
  reportId,
}: InsightViewProps) {
  const insightId = insight.id;
  const navigate = useNavigate();

  // Local state for insight name (prevents re-renders on typing)
  const [localName, setLocalName] = useState(insight.name);
  const setWebMCPInsight = useWebMCPPageStore((state) => state.setInsight);
  const updateWebMCPInsight = useWebMCPPageStore(
    (state) => state.updateInsight,
  );
  const clearWebMCPInsight = useWebMCPPageStore((state) => state.clearInsight);
  useEffect(() => {
    setWebMCPInsight({ insightId });
    return () => clearWebMCPInsight(insightId);
  }, [clearWebMCPInsight, insightId, setWebMCPInsight]);
  useEffect(() => {
    updateWebMCPInsight(insightId, {
      pendingName: localName !== insight.name ? localName : undefined,
    });
  }, [insight.name, insightId, localName, updateWebMCPInsight]);
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
  const [insightPaneOpen, setInsightPaneOpen] = useState(true);
  const [visualizationPaneOpen, setVisualizationPaneOpen] = useState(true);
  const [visualModeRequestedFor, setVisualModeRequestedFor] = useState<
    string | null
  >(null);

  // Mutations — artifact writes go through commitBatch (one batch per user edit).
  const commitBatch = useMutation(api.app.commitBatch);
  const updateVisualization = useCallback(
    async (args: {
      id: UUID;
      updates: Parameters<typeof buildVisualizationUpdateCommands>[1];
    }) => {
      const commands = buildVisualizationUpdateCommands(args.id, args.updates);
      if (commands.length === 0) return;
      await commitBatch({ commands });
    },
    [commitBatch],
  );
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
  const { data: allDataTables = [] } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const { data: allInsights = [] } = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  );
  const { data: allVisualizations = [] } = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const {
    data: dashboards = [],
    isPending: dashboardsPending,
    isError: dashboardsError,
  } = queryStatus(useQuery({ query: api.app.listDashboards, args: {} }));
  const persistedActiveView = useInsightCanvasStore(
    (s) => s.activeViewByInsight[insightId],
  );
  const setPersistedActiveView = useInsightCanvasStore((s) => s.setActiveView);

  // The root table provides source-frame prerequisites; authoring uses the immediate output.
  const dataTable = useMemo(
    () => resolveInsightSourceDataTable(insight, allDataTables, allInsights),
    [allDataTables, allInsights, insight],
  );
  const authoringTable = useMemo(
    () => resolveInsightAuthoringTable(insight, allDataTables, allInsights),
    [allDataTables, allInsights, insight],
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
    columnDisplayNames: chartSuggestionColumnDisplayNames,
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
  const {
    columns: encodingModelColumns,
    columnDisplayNames: encodingModelColumnDisplayNames,
    resolvedFields: encodingResolvedFields,
  } = useInsightPagination({
    insight,
    showModelPreview: true,
    enabled: persistedActiveView?.kind === "visualization",
  });
  const {
    columnDisplayNames: encodingRenderedColumnDisplayNames,
    schema: encodingSchema,
    sampleRows: encodingRows,
    totalCount: encodingRowCount,
    isReady: areEncodingsReady,
  } = useInsightPagination({
    insight,
    showModelPreview: false,
    enabled: persistedActiveView?.kind === "visualization",
  });
  const encodingColumnDisplayNames = useMemo(() => {
    const displayNames = {
      ...chartSuggestionColumnDisplayNames,
      ...encodingModelColumnDisplayNames,
    };
    for (const column of encodingModelColumns) {
      const renderedLabel = encodingRenderedColumnDisplayNames[column.name];
      if (renderedLabel && !isGeneratedColumnLabel(renderedLabel)) {
        displayNames[column.name] = renderedLabel;
        continue;
      }
      displayNames[column.name] ??= column.name;
    }
    return displayNames;
  }, [
    chartSuggestionColumnDisplayNames,
    encodingModelColumnDisplayNames,
    encodingModelColumns,
    encodingRenderedColumnDisplayNames,
  ]);
  const encodingColumnAnalysis = useMemo<ColumnAnalysis[]>(
    () =>
      areEncodingsReady
        ? analyzeFrameSample(encodingSchema, encodingRows, encodingRowCount)
        : [],
    [areEncodingsReady, encodingRowCount, encodingRows, encodingSchema],
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
    if (!authoringTable) return {};
    const map: Record<string, Field> = {};

    // Add base table fields (keyed by field ID)
    (authoringTable.fields ?? [])
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
  }, [authoringTable, insight.joins, allDataTables]);

  const encodingAvailableFields = useMemo(() => {
    const fields = new Map<string, Field>();
    for (const field of Object.values(fieldMap)) fields.set(field.id, field);
    for (const field of encodingResolvedFields) fields.set(field.id, field);
    return [...fields.values()];
  }, [encodingResolvedFields, fieldMap]);
  const compiledInsightForEncodings = useMemo<CompiledInsight>(() => {
    const fieldsById = new Map(
      encodingAvailableFields.map((field) => [field.id, field]),
    );
    return {
      id: insight.id,
      name: insight.name,
      dimensions: insight.selectedFields
        .map((fieldId) => fieldsById.get(fieldId))
        .filter((field): field is Field => Boolean(field)),
      metrics: insight.metrics ?? [],
      filters: insight.filters,
      sorts: insight.sorts,
    };
  }, [encodingAvailableFields, insight]);

  // Get existing field and metric column names from insight configuration
  // Includes fields from both base table AND joined tables
  const existingFieldNames = useMemo(() => {
    if (!authoringTable) return [];

    const names: string[] = [];

    // Map selected field IDs to column names (includes base + joined tables)
    const fieldIdToName = new Map<string, string>();
    (authoringTable.fields ?? []).forEach((f) => {
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
    authoringTable,
    insight.selectedFields,
    insight.metrics,
    insight.joins,
    allDataTables,
  ]);

  // Create minimal insight object for suggestions
  // Uses LocalInsight type from stores which is expected by suggestCharts
  const insightForSuggestions = useMemo<LocalInsight | null>(() => {
    if (!authoringTable) return null;
    return {
      id: insightId,
      name: insight.name,
      baseTable: {
        tableId: authoringTable.id,
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
    authoringTable,
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

    for (const chartType of INSIGHT_CANVAS_CHART_TYPES) {
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
    for (const chartType of INSIGHT_CANVAS_CHART_TYPES) {
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
      if (!dataTable?.dataFrameId || !authoringTable || !isChartViewReady)
        return null;

      // Parse encoding to extract dimensions and metrics
      const { dimensionFields, metrics } = parseChartEncoding(
        suggestion.encoding,
        parseAggregateExpression,
        authoringTable.id,
      );

      // Map dimension column names to field IDs (base table + joined tables)
      // Supports both original column names AND UUID-based aliases (field_<uuid>)
      // because suggestions use UUID aliases but we need to look up field IDs
      const fieldIdMap = new Map<string, UUID>();
      const metricIdentityFields: Field[] = [];

      // Base table fields - add both original name and UUID alias
      (authoringTable.fields ?? []).forEach((f) => {
        metricIdentityFields.push({ ...f, tableId: authoringTable.id });
        fieldIdMap.set(f.columnName ?? f.name, f.id);
        // Also add UUID-based alias (field_<uuid>) for suggestion encoding lookups
        fieldIdMap.set(fieldIdToColumnAlias(f.id), f.id);
      });

      // Joined table fields - add both original name and UUID alias
      insight.joins?.forEach((join) => {
        const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
        if (joinTable) {
          (joinTable.fields ?? []).forEach((f) => {
            metricIdentityFields.push({ ...f, tableId: joinTable.id });
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
      const newSelectedFieldIds = resolveSuggestionDimensionFieldIds(
        fieldIdMap,
        dimensionFields,
      );

      // Suggestion encodings reference UUID column aliases, so metrics parsed
      // from them carry names like "sum(field_<uuid>)". Rename to the field's
      // display name for the Metrics panel; columnName stays untouched for SQL
      // generation while identity matching resolves it through field metadata.
      const fieldNameById = new Map<UUID, string>();
      (authoringTable.fields ?? []).forEach((f) =>
        fieldNameById.set(f.id, f.name),
      );
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
        metricIdentityFields,
        fieldIdMap,
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
        metricIdentityFields,
        authoringTable.id,
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
      authoringTable,
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

  const addToReportTarget = resolveAddToReportTarget({
    reportId,
    dashboards,
    isPending: dashboardsPending,
    isError: dashboardsError,
  });

  const handleAddActiveViewToDashboard = useCallback(async () => {
    try {
      if (addToReportTarget.kind === "pending") return;
      if (addToReportTarget.kind === "query-error") {
        toast.error("Couldn't load reports");
        return;
      }
      if (addToReportTarget.kind === "missing-report") {
        toast.error("This report is no longer available");
        return;
      }
      const dashboard = addToReportTarget.dashboard;
      const visualizationId = await ensureActiveVisualization();
      if (!visualizationId) return;
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
      toast.success("Added to report");
      if (reportId) navigate({ to: `/dashboards/${reportId}` } as never);
    } catch (error) {
      console.error("[InsightView] Add to dashboard failed:", error);
      toast.error("Couldn't add to dashboard");
    }
  }, [
    addToReportTarget,
    commitBatch,
    ensureActiveVisualization,
    insight.name,
    reportId,
    navigate,
  ]);

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

      navigate(visualizationDetailLink(newVizId, reportId) as never);
    },
    [
      insightVisualizations,
      createVisualizationLocal,
      insightId,
      navigate,
      reportId,
    ],
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

  const viewStatus = getViewStatus(activeView, activeVisualization?.name);
  const canPinActiveChart =
    activeView.kind === "chart" && activeChartSuggestion !== undefined;
  const canAddActiveViewToDashboard =
    (activeView.kind === "visualization" ||
      (activeView.kind === "chart" && activeChartSuggestion !== undefined)) &&
    addToReportTarget.kind !== "pending";
  const visualizationPane = resolveVisualizationPaneState(
    activeView,
    activeVisualization?.visualizationType,
    visualizationPaneOpen,
  );

  // Data table not found - check after all hooks are called
  if (!dataTable || !authoringTable) {
    return <NotFoundView type="dataTable" />;
  }

  return (
    <AppLayout pageHeader={null} childrenClassName="overflow-hidden">
      <div
        data-dashframe-insight-id={insightId}
        className="flex h-full min-w-0 overflow-hidden"
      >
        <aside
          inert={!insightPaneOpen}
          aria-hidden={!insightPaneOpen}
          className={cn(
            "h-full shrink-0 overflow-hidden transition-[width] duration-200",
            insightPaneOpen ? "w-64" : "w-0",
          )}
        >
          <div className="h-full w-64">
            <InsightConfigPanel
              insight={insight}
              dataTable={authoringTable}
              allDataTables={allDataTables}
              reportId={reportId}
            />
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden px-1.5 py-2">
          {/* Collapses by the header's own width: view labels below 48rem,
              breadcrumb below 42rem, action labels below 36rem. Under ~23rem
              (both panes open on a small window) it scrolls rather than clip. */}
          <header className="@container flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto px-1 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0 [&>input]:shrink">
            <Button
              size="sm"
              variant="ghost"
              icon={insightPaneOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
              iconOnly
              label={
                insightPaneOpen
                  ? "Collapse Insight pane"
                  : "Expand Insight pane"
              }
              onClick={() => setInsightPaneOpen((open) => !open)}
            />
            <Link
              to="/insights"
              className="shrink-0 rounded-sm px-1 @max-2xl:hidden text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
            >
              Insights
            </Link>
            <span
              aria-hidden
              className="shrink-0 text-xs text-neutral-fg-subtle @max-2xl:hidden"
            >
              ›
            </span>
            <label className="sr-only" htmlFor="insight-name">
              Insight name
            </label>
            <input
              id="insight-name"
              value={localName}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Untitled insight"
              className="min-w-16 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-fg outline-none placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary"
            />
            {viewStatus && (
              <span className="hidden max-w-48 min-w-0 truncate text-xs text-neutral-fg-subtle 2xl:inline">
                {viewStatus}
              </span>
            )}
            <div className="flex shrink-0 rounded-md bg-neutral-bg-muted p-0.5">
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
                description="Chart the rows produced by the current data model."
                onClick={handleSelectVisualMode}
              />
            </div>
            {canPinActiveChart && (
              <ControlTooltip
                label="Save chart"
                description="Keep this chart as a reusable view for dashboards."
              >
                <Button
                  size="sm"
                  variant="outline"
                  label="Save chart"
                  onClick={handlePinActiveChart}
                >
                  <PlusIcon aria-hidden />
                  <span className="@max-xl:sr-only">Save chart</span>
                </Button>
              </ControlTooltip>
            )}
            <ControlTooltip
              label="Add to report"
              description="Place this view on a report."
            >
              <Button
                size="sm"
                label="Add to report"
                onClick={handleAddActiveViewToDashboard}
                disabled={!canAddActiveViewToDashboard}
              >
                <DashboardIcon aria-hidden />
                <span className="@max-xl:sr-only">Add to report</span>
              </Button>
            </ControlTooltip>
            <InsightMoreActionsMenu
              onInspectDataFrames={() => navigate({ to: "/data-frames" })}
              savedChart={
                activeView.kind === "visualization"
                  ? activeVisualization
                  : undefined
              }
              onDuplicateChart={handleDuplicateVisualization}
              onDeleteChart={handleDeleteVisualization}
            />
            {visualizationPane.available && (
              <Button
                size="sm"
                variant="ghost"
                icon={
                  visualizationPane.attached
                    ? PanelRightCloseIcon
                    : PanelRightOpenIcon
                }
                iconOnly
                label={
                  visualizationPane.attached
                    ? "Collapse Visualization pane"
                    : "Expand Visualization pane"
                }
                onClick={() => setVisualizationPaneOpen((open) => !open)}
              />
            )}
          </header>

          <InsightCanvasWell
            insight={insight}
            showChart={activeView.kind !== "table"}
          >
            {activeView.kind === "chart" && (
              <EphemeralChartCanvas
                tableName={chartSuggestionFrameId ?? undefined}
                suggestion={activeChartSuggestion}
                isLoading={!areChartSuggestionsReady}
                onRegenerate={handleRegenerate}
              />
            )}
            {activeView.kind === "visualization" && activeVisualization && (
              <VisualizationPreview
                visualization={activeVisualization}
                height="container"
              />
            )}
          </InsightCanvasWell>
        </section>

        <aside
          inert={!visualizationPane.attached}
          aria-hidden={!visualizationPane.attached}
          className={cn(
            "h-full min-w-0 shrink-0 overflow-hidden transition-[width] duration-200",
            visualizationPane.attached ? "w-60" : "w-0",
          )}
        >
          <div className="h-full w-60 min-w-0">
            <VisualizationConfigPanel
              activeChartType={visualizationPane.chartType}
              availableChartTypes={new Set(chartSuggestionsByType.keys())}
              activeSuggestionEncoding={activeChartSuggestion?.encoding}
              activeVisualization={activeVisualization}
              visualizations={insightVisualizations}
              compiledInsight={compiledInsightForEncodings}
              dataTable={authoringTable}
              availableFields={encodingAvailableFields}
              availableColumns={encodingModelColumns.map((column) => ({
                name: column.name,
                type: column.type ?? "unknown",
              }))}
              columnDisplayNames={encodingColumnDisplayNames}
              columnAnalysis={encodingColumnAnalysis}
              onSelectChartType={(chartType) =>
                handleSetActiveView(chartView(chartType))
              }
              onSelectVisualization={(visualizationId) =>
                handleSetActiveView(visualizationView(visualizationId))
              }
              updateVisualization={updateVisualization}
            />
          </div>
        </aside>
      </div>
    </AppLayout>
  );
}
