import { usePivotSortOptions } from "@/hooks/usePivotSortOptions";
import { ReportSwitchers } from "@/components/visualizations/ReportSwitchers";
import {
  currentViewerRuntime,
  reportPresentation,
  reportEncoding,
  reportPivotColor,
} from "@/lib/insights/report-runtime";
import {
  ReportDataTable,
  hasReportTable,
} from "@/components/visualizations/ReportDataTable";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useTopBarTabs, type TopBarTabs } from "@/components/shell/topbar-tabs";
import {
  Workbench,
  WorkbenchPaneToggle,
  useWorkbenchPanes,
} from "@/components/workbench/Workbench";
import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { getVisualizationTypeChange } from "@/components/visualizations/visualization-type-change";
import {
  resolveInsightSourceDataTable,
  useInsightPagination,
} from "@/hooks/useInsightPagination";
import { formatCellValue } from "@/lib/cell-formatter";
import { buildInsightColumnDisplayNames } from "@/lib/insight-column-display-names";
import { resolveInsightAuthoringTable } from "@/lib/insights/compute-combined-fields";
import type { ConfirmDialogConfig } from "@/lib/stores/confirm-dialog-store";
import {
  sanitizeInsightCanvasView,
  TABLE_CANVAS_VIEW,
  useInsightCanvasStore,
  type InsightCanvasView,
} from "@/lib/stores/insight-canvas-store";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import type { Insight as LocalInsight } from "@/lib/stores/types";
import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import { validateEncoding } from "@/lib/visualizations/encoding-enforcer";
import {
  suggestByChartType,
  type ChartSuggestion,
} from "@/lib/visualizations/suggest-charts";
import { api } from "@dashframe/convex-backend/api";
import {
  buildInsightAvailableFields,
  extractUUIDFromColumnAlias,
  fieldIdToColumnAlias,
} from "@dashframe/engine";
import type {
  ChartEncoding,
  ColumnAnalysis,
  CompiledInsight,
  DataTable,
  CommandPayloads,
  Field,
  Insight,
  InsightMetric,
  InsightRuntimeInput,
  UUID,
  VegaLiteSpec,
  Visualization,
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
  CHART_ICONS,
  VirtualTable,
  type VirtualTableColumnConfig,
  type WorkbenchTabItem,
} from "@dashframe/ui";
import { Chart } from "@dashframe/visualization";

import { Button, cn, ErrorState } from "@wystack/ui-react";
import { PlusIcon, SparklesIcon, TableIcon } from "@wystack/ui-react/icons";
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

export function shouldMaterializeReportResult(
  activeView: InsightCanvasView,
  insight: Insight,
): boolean {
  return (
    activeView.kind !== "chart" ||
    Boolean(insight.reporting?.pivotFields?.length)
  );
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
    reporting: undefined,
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

export function shouldMaterializeChartSuggestion(input: {
  activeView: InsightCanvasView;
  visualizeIntent: boolean;
  hasVisualization: boolean;
  visualModeRequested: boolean;
}): boolean {
  return (
    input.activeView.kind === "chart" ||
    input.visualModeRequested ||
    (input.visualizeIntent && !input.hasVisualization)
  );
}

export function buildInsightModelMetadata(
  insight: Insight,
  authoringTable: DataTable | undefined,
  allDataTables: DataTable[],
) {
  if (!authoringTable) return { fields: [], columnDisplayNames: {} };
  const joinedTables = new Map<UUID, DataTable>();
  for (const join of insight.joins ?? []) {
    const joined = allDataTables.find(
      (candidate) => candidate.id === join.rightTableId,
    );
    if (joined) joinedTables.set(joined.id, joined);
  }
  const fields =
    buildInsightAvailableFields(authoringTable, joinedTables, insight) ?? [];
  return {
    fields,
    columnDisplayNames: buildInsightColumnDisplayNames(insight, fields, {
      baseTable: authoringTable,
      joinedTables,
    }),
  };
}

export const MAX_DOT_ROW_COUNT = 10_000;

/** One rendered result supplies every saved-chart encoding input. */
export function useInsightEncodingMetadata(
  insight: Insight,
  enabled: boolean,
  runtime?: InsightRuntimeInput,
) {
  return useInsightPagination({
    insight,
    showModelPreview: false,
    enabled,
    ...(runtime ? { runtime } : {}),
  });
}

export function canChangeSavedVisualizationType(input: {
  visualization: Pick<Visualization, "visualizationType" | "encoding">;
  chartType: VisualizationType;
  encodingsReady: boolean;
  encodingRowCount: number;
  encodingColumnAnalysis: ColumnAnalysis[];
  compiledInsight: CompiledInsight;
}): boolean {
  const {
    visualization,
    chartType,
    encodingsReady,
    encodingRowCount,
    encodingColumnAnalysis,
    compiledInsight,
  } = input;
  if (chartType === visualization.visualizationType) return true;
  if (chartType === "dot" && encodingRowCount > MAX_DOT_ROW_COUNT) {
    return false;
  }
  if (!encodingsReady) return false;
  const updates = getVisualizationTypeChange(visualization, chartType);
  const encoding = updates?.encoding ?? visualization.encoding ?? {};
  if (!encoding.x || !encoding.y) return false;
  const errors = validateEncoding(
    encoding,
    chartType,
    encodingColumnAnalysis,
    compiledInsight,
  );
  return !errors.x && !errors.y;
}

/**
 * The new-chart tab opens a fresh draft from the best suggestion. It never
 * reopens a saved chart: each of those has a tab of its own.
 */
export function resolveNewChartTarget(input: {
  suggestionsReady: boolean;
  firstSuggestedChartType?: VisualizationType;
}): Extract<InsightCanvasView, { kind: "chart" }> | null {
  if (!input.suggestionsReady) return null;
  return input.firstSuggestedChartType
    ? chartView(input.firstSuggestedChartType)
    : null;
}

export function resolvePendingNewChartTarget(input: {
  requestedInsightId: string | null;
  currentInsightId: string;
  suggestionsReady: boolean;
  firstSuggestedChartType?: VisualizationType;
}): Extract<InsightCanvasView, { kind: "chart" }> | null {
  if (input.requestedInsightId !== input.currentInsightId) return null;
  return resolveNewChartTarget(input);
}

export function shouldClearSavedDraft(input: {
  savedVisualizationId: string | null;
  savedChartType: VisualizationType;
  currentDraftChartType?: VisualizationType;
}): boolean {
  return (
    input.savedVisualizationId !== null &&
    input.currentDraftChartType === input.savedChartType
  );
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

const CANVAS_PANEL_ID = "insight-canvas-panel";
const DATA_TAB_ID = "canvas:data";
const DRAFT_TAB_ID = "canvas:draft";
const VIZ_TAB_PREFIX = "canvas:viz:";

function canvasViewTabId(view: InsightCanvasView): string {
  if (view.kind === "table") return DATA_TAB_ID;
  if (view.kind === "chart") return DRAFT_TAB_ID;
  return `${VIZ_TAB_PREFIX}${view.visualizationId}`;
}

function chartView(
  chartType: VisualizationType,
): Extract<InsightCanvasView, { kind: "chart" }> {
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

type InsightPaginationResult = ReturnType<typeof useInsightPagination>;

/** Runtime output — a stack, a WASM or engine error — is not copy. */
const RUNTIME_OUTPUT =
  /\n|\bat \S+ \(|wasm|emscripten|\b[A-Z][a-z]+ Error:|Exception/i;

const UNREADABLE_RESULT_COPY =
  "The data for this chart couldn't be read. Try again, or check its data source.";

/**
 * What a result failure says. The host writes its failures for people, but
 * nothing reaches the screen that reads as runtime output: that becomes plain
 * copy, and the error state's Retry is the way out.
 */
export function resultErrorCopy(error: string): string {
  return RUNTIME_OUTPUT.test(error) ? UNREADABLE_RESULT_COPY : error;
}

/** Shared error element so the workbench's table and chart halves agree. */
export function InsightResultErrorState({
  error,
  onRetry,
  className,
}: {
  error: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <ErrorState
      title="Couldn't load data"
      description={resultErrorCopy(error)}
      size="sm"
      className={className}
      retryAction={onRetry ? { label: "Retry", onClick: onRetry } : undefined}
    />
  );
}

export function InsightResultTable({
  insight,
  result,
  collapsed = false,
  onToggleCollapsed,
  className,
}: {
  insight?: Insight;
  result: InsightPaginationResult;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
}) {
  const {
    fetchData,
    totalCount,
    fieldCount,
    isReady,
    error,
    retry,
    columnDisplayNames,
    columnTypeMap,
  } = result;

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

  // A failed materialization stays `!isReady` forever: show its message rather
  // than "Loading data..." so this half agrees with the chart's error state.
  let summary = "Loading data...";
  if (isReady) {
    summary = `${(totalCount || 0).toLocaleString()} rows • ${(fieldCount || 0).toLocaleString()} fields`;
  } else if (error) {
    summary = "Couldn't load data";
  }

  // Mount the table only when the pagination hook is ready (per its contract):
  // mounting earlier lets the initial fetch race the hook's own init-driven
  // fetchData identity changes.
  let tableBody: ReactNode = null;
  if (isReady) {
    tableBody = (
      <div className="absolute inset-0">
        {hasReportTable(insight) ? (
          <ReportDataTable
            insight={insight}
            fetchData={fetchData}
            totalCount={totalCount}
            columnDisplayNames={columnDisplayNames}
          />
        ) : (
          <VirtualTable
            onFetchData={fetchData}
            columnConfigs={columnConfigs}
            height="100%"
            compact
          />
        )}
      </div>
    );
  } else if (error) {
    tableBody = (
      <div className="absolute inset-0 overflow-auto">
        <InsightResultErrorState
          error={error}
          onRetry={retry}
          className="min-h-full"
        />
      </div>
    );
  }

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
        {tableBody}
      </div>
    </div>
  );
}

/**
 * Sunken well for the work canvas. Chart views lift the chart onto a raised
 * card above the result table; the data view shows the table alone.
 */
function InsightCanvasWell({
  insight,
  result,
  showChart,
  children,
}: {
  insight?: Insight;
  result: InsightPaginationResult;
  showChart: boolean;
  children: ReactNode;
}) {
  const [resultCollapsed, setResultCollapsed] = useState(false);
  return (
    <div
      id={CANVAS_PANEL_ID}
      role="tabpanel"
      aria-label="Canvas"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg-muted p-2 shadow-inner dark:bg-neutral-bg-dim"
    >
      {showChart ? (
        <>
          <div className="min-h-0 flex-[1_1_68%] overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg p-3 shadow-[var(--surface-shadow)] dark:bg-neutral-bg-subtle">
            {children}
          </div>
          <InsightResultTable
            insight={insight}
            result={result}
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
        <InsightResultTable
          insight={insight}
          result={result}
          className="flex-1"
        />
      )}
    </div>
  );
}

function EphemeralChartCanvas({
  detailRowsOnly,
  tableName,
  suggestion,
  isLoading,
  error,
  onRetry,
  onRegenerate,
}: {
  tableName?: string;
  detailRowsOnly?: boolean;
  suggestion?: ChartSuggestion;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRegenerate: () => void;
}) {
  // A failed suggestion materialization never becomes ready — show the error
  // so this half agrees with the result table below instead of loading forever.
  if (error) {
    return (
      <InsightResultErrorState
        error={error}
        onRetry={onRetry}
        className="h-full"
      />
    );
  }

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
      detailRowsOnly={detailRowsOnly}
      tableName={tableName}
      visualizationType={suggestion.chartType}
      encoding={suggestion.encoding}
      height="container"
      className="h-full w-full"
    />
  );
}

/** What a host puts in the workbench's header, between the pane toggles. */
export interface InsightWorkbenchHeaderContext {
  activeView: InsightCanvasView;
  /** The saved chart on the canvas, if one is. */
  activeVisualization: Visualization | undefined;
  insightVisualizations: Visualization[];
  /** A suggested chart is on the canvas and can be saved. */
  canPinActiveChart: boolean;
  pinActiveChart: () => Promise<void>;
  /** Saves the suggested chart on the canvas if needed; the chart's id. */
  ensureActiveVisualization: () => Promise<UUID | null>;
}

export interface InsightWorkbenchProps {
  insight: Insight;
  /** What the canvas shows; a chart that no longer exists shows the data. */
  view: InsightCanvasView;
  onViewChange: (view: InsightCanvasView) => void;
  reportId?: string;
  visualizeIntent?: boolean;
  /**
   * Shows the insight's own views (its data, each chart, a new chart) as the
   * top-bar tabs. Only a page that is the insight itself does this; a host
   * with its own tabs leaves it off.
   */
  canvasTabs?: boolean;
  /** Header contents between the pane toggles: identity and actions. */
  header: (context: InsightWorkbenchHeaderContext) => ReactNode;
  /** One line under the left pane's title. */
  leftPaneNote?: ReactNode;
  /** Shown instead of the workbench when the insight's table is gone. */
  missingTable?: ReactNode;
}

function CanvasTopBarTabs({ tabs }: { tabs: TopBarTabs | null }) {
  useTopBarTabs(tabs);
  return null;
}

/**
 * The insight workbench: the query on the left, the chart and its result in
 * the centre, the chart's encodings on the right. Route-free: the host owns
 * the page around it, which view is open, and the header's contents.
 */
export function InsightWorkbench({
  insight,
  view,
  onViewChange,
  visualizeIntent = false,
  reportId,
  canvasTabs = false,
  header,
  leftPaneNote,
  missingTable,
}: InsightWorkbenchProps) {
  const insightId = insight.id;
  const [viewerState, setViewerState] = useState<{
    id: string;
    runtime?: InsightRuntimeInput;
  }>({ id: insightId });
  const viewerRuntime = useMemo(
    () =>
      currentViewerRuntime(
        insight,
        viewerState.id === insightId ? viewerState.runtime : undefined,
      ),
    [insight, insightId, viewerState],
  );
  const displayInsight = useMemo(
    () => reportPresentation(insight, viewerRuntime),
    [insight, viewerRuntime],
  );

  const setWebMCPInsight = useWebMCPPageStore((state) => state.setInsight);
  const clearWebMCPInsight = useWebMCPPageStore((state) => state.clearInsight);
  useEffect(() => {
    setWebMCPInsight({ insightId });
    return () => clearWebMCPInsight(insightId);
  }, [clearWebMCPInsight, insightId, setWebMCPInsight]);

  const [suggestionSeed, setSuggestionSeed] = useState(0);
  const {
    leftOpen: insightPaneOpen,
    rightOpen: visualizationPaneOpen,
    toggleLeft: toggleInsightPane,
    toggleRight: toggleVisualizationPane,
  } = useWorkbenchPanes("insight");
  const visualizationWriteStatusRef = useRef({
    pending: false,
    generation: 0,
  });
  const handleVisualizationWritePendingChange = useCallback(
    (pending: boolean) => {
      const current = visualizationWriteStatusRef.current;
      visualizationWriteStatusRef.current = {
        pending,
        generation:
          pending && !current.pending
            ? current.generation + 1
            : current.generation,
      };
    },
    [],
  );
  const getVisualizationWriteStatus = useCallback(
    () => visualizationWriteStatusRef.current,
    [],
  );
  const [newChartRequestedFor, setNewChartRequestedFor] = useState<
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
  const draftChartType = useInsightCanvasStore(
    (s) => s.draftChartTypeByInsight[insightId],
  );
  const setDraftChartType = useInsightCanvasStore((s) => s.setDraftChartType);
  const clearDraftChartType = useInsightCanvasStore(
    (s) => s.clearDraftChartType,
  );

  // The root table provides source-frame prerequisites; authoring uses the immediate output.
  const dataTable = useMemo(
    () => resolveInsightSourceDataTable(insight, allDataTables, allInsights),
    [allDataTables, allInsights, insight],
  );
  const authoringTable = useMemo(
    () => resolveInsightAuthoringTable(insight, allDataTables, allInsights),
    [allDataTables, allInsights, insight],
  );
  const {
    fields: modelResolvedFields,
    columnDisplayNames: modelColumnDisplayNames,
  } = useMemo(
    () => buildInsightModelMetadata(insight, authoringTable, allDataTables),
    [allDataTables, authoringTable, insight],
  );

  const insightVisualizations = useMemo(
    () => allVisualizations.filter((v) => v.insightId === insightId),
    [allVisualizations, insightId],
  );
  const pinnedVisualizationIds = useMemo(
    () => new Set(insightVisualizations.map((viz) => viz.id)),
    [insightVisualizations],
  );
  const activeView = useMemo(
    () => sanitizeInsightCanvasView(view, pinnedVisualizationIds),
    [view, pinnedVisualizationIds],
  );
  const chartSuggestionInsight = useMemo(
    () => buildChartSuggestionInsight(insight),
    [insight],
  );
  const chartSuggestionResult = useInsightPagination({
    insight: chartSuggestionInsight,
    showModelPreview: true,
    enabled: shouldMaterializeChartSuggestion({
      activeView,
      visualizeIntent,
      hasVisualization: insightVisualizations.length > 0,
      visualModeRequested: newChartRequestedFor === insightId,
    }),
  });
  const {
    dataFrameId: chartSuggestionFrameId,
    isReady: areChartSuggestionsReady,
    columnDisplayNames: chartSuggestionColumnDisplayNames,
    schema: chartSuggestionSchema,
    sampleRows: chartSuggestionRows,
    totalCount: chartSuggestionRowCount,
  } = chartSuggestionResult;
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
  const activeVisualization =
    activeView.kind === "visualization"
      ? insightVisualizations.find(
          (viz) => viz.id === activeView.visualizationId,
        )
      : undefined;
  const savedInsightResult = useInsightEncodingMetadata(
    insight,
    shouldMaterializeReportResult(activeView, insight),
    viewerRuntime,
  );
  const {
    options: pivotSortOptions,
    error: pivotSortError,
    retry: retryPivotSort,
  } = usePivotSortOptions(
    insight,
    savedInsightResult,
    displayInsight.selectedFields,
  );
  const {
    columns: encodingColumns,
    columnDisplayNames: encodingRenderedColumnDisplayNames,
    resolvedFields: encodingResolvedFields,
    schema: encodingSchema,
    sampleRows: encodingRows,
    totalCount: encodingRowCount,
    isReady: areEncodingsReady,
    error: encodingResultError,
    retry: retryEncodingResult,
  } = savedInsightResult;
  const encodingColumnDisplayNames = useMemo(() => {
    const displayNames = {
      ...modelColumnDisplayNames,
      ...chartSuggestionColumnDisplayNames,
      ...encodingRenderedColumnDisplayNames,
    };
    for (const column of encodingColumns) {
      displayNames[column.name] ??= column.name;
    }
    return displayNames;
  }, [
    chartSuggestionColumnDisplayNames,
    encodingColumns,
    encodingRenderedColumnDisplayNames,
    modelColumnDisplayNames,
  ]);
  const encodingColumnAnalysis = useMemo<ColumnAnalysis[]>(
    () =>
      areEncodingsReady
        ? analyzeFrameSample(encodingSchema, encodingRows, encodingRowCount)
        : [],
    [areEncodingsReady, encodingRowCount, encodingRows, encodingSchema],
  );

  // No write-back of the sanitized view into the store: right after a pin,
  // the persisted selection can reference a visualization the list hasn't
  // loaded yet — persisting the table fallback would clobber that intent.
  // Read-time sanitization above is enough; the view self-heals on load.

  const handleSetActiveView = onViewChange;

  const openDraftChart = useCallback(
    (chartType: VisualizationType) => {
      setNewChartRequestedFor(null);
      setDraftChartType(insightId, chartType);
      handleSetActiveView(chartView(chartType));
    },
    [handleSetActiveView, insightId, setDraftChartType],
  );

  const handleSelectVisualization = useCallback(
    (visualizationId: string) => {
      setNewChartRequestedFor(null);
      handleSetActiveView(visualizationView(visualizationId));
    },
    [handleSetActiveView],
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
    for (const field of encodingResolvedFields) fields.set(field.id, field);
    return [...fields.values()];
  }, [encodingResolvedFields]);
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
  // Also checked against the pending encoding when a type change is written,
  // since the set below reflects only the last echoed visualization.
  const canChangeChartType = useCallback(
    (
      visualization: Pick<Visualization, "visualizationType" | "encoding">,
      chartType: VisualizationType,
    ) =>
      canChangeSavedVisualizationType({
        visualization,
        chartType,
        encodingsReady: areEncodingsReady,
        encodingRowCount,
        encodingColumnAnalysis,
        compiledInsight: compiledInsightForEncodings,
      }),
    [
      areEncodingsReady,
      compiledInsightForEncodings,
      encodingColumnAnalysis,
      encodingRowCount,
    ],
  );
  const availableVisualizationTypes = useMemo(() => {
    if (!activeVisualization) {
      return new Set(chartSuggestionsByType.keys());
    }
    if (!areEncodingsReady) {
      return new Set([activeVisualization.visualizationType]);
    }
    return new Set(
      INSIGHT_CANVAS_CHART_TYPES.filter((chartType) =>
        canChangeChartType(activeVisualization, chartType),
      ),
    );
  }, [
    activeVisualization,
    areEncodingsReady,
    canChangeChartType,
    chartSuggestionsByType,
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
      if (
        !dataTable?.dataFrameId ||
        !authoringTable ||
        !areChartSuggestionsReady
      )
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
      areChartSuggestionsReady,
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
        isChartViewReady: areChartSuggestionsReady,
      })
    ) {
      return;
    }
    if (!firstChartSuggestion) return;

    autoPinAttemptRef.current = insightId;
    pinChartSuggestion(firstChartSuggestion).catch((error) => {
      console.error("[InsightWorkbench] Auto-save failed:", error);
      toast.error("Couldn't save the chart");
    });
  }, [
    firstChartSuggestion,
    dataTable?.dataFrameId,
    insightId,
    insightVisualizations.length,
    areChartSuggestionsReady,
    pinChartSuggestion,
    visualizeIntent,
  ]);

  const handlePinActiveChart = useCallback(async () => {
    if (!activeChartSuggestion || activeView.kind !== "chart") return;
    const savedChartType = activeView.chartType;
    try {
      const savedVisualizationId = await pinChartSuggestion(
        activeChartSuggestion,
      );
      if (!savedVisualizationId) {
        toast.error("Chart is still loading");
        return;
      }
      const currentDraftChartType =
        useInsightCanvasStore.getState().draftChartTypeByInsight[insightId];
      if (
        shouldClearSavedDraft({
          savedVisualizationId,
          savedChartType,
          currentDraftChartType,
        })
      ) {
        clearDraftChartType(insightId);
      }
      toast.success("Chart saved");
    } catch (error) {
      console.error("[InsightWorkbench] Save failed:", error);
      toast.error("Couldn't save the chart");
    }
  }, [
    activeChartSuggestion,
    activeView,
    clearDraftChartType,
    insightId,
    pinChartSuggestion,
  ]);

  const ensureActiveVisualization =
    useCallback(async (): Promise<UUID | null> => {
      if (activeView.kind === "visualization")
        return activeView.visualizationId;
      if (activeView.kind === "chart" && activeChartSuggestion) {
        const savedChartType = activeView.chartType;
        const visualizationId = await pinChartSuggestion(activeChartSuggestion);
        const currentDraftChartType =
          useInsightCanvasStore.getState().draftChartTypeByInsight[insightId];
        if (
          shouldClearSavedDraft({
            savedVisualizationId: visualizationId,
            savedChartType,
            currentDraftChartType,
          })
        ) {
          clearDraftChartType(insightId);
        }
        return visualizationId;
      }
      return null;
    }, [
      activeChartSuggestion,
      activeView,
      clearDraftChartType,
      insightId,
      pinChartSuggestion,
    ]);

  const handleSelectNewChart = useCallback(() => {
    // The draft already occupies the slot; selecting it just reopens it.
    if (activeView.kind === "chart") return;
    if (draftChartType) {
      openDraftChart(draftChartType);
      return;
    }
    const target = resolveNewChartTarget({
      suggestionsReady: areChartSuggestionsReady,
      firstSuggestedChartType: firstChartSuggestion?.chartType,
    });
    if (target) openDraftChart(target.chartType);
    else setNewChartRequestedFor(insightId);
  }, [
    activeView.kind,
    areChartSuggestionsReady,
    draftChartType,
    firstChartSuggestion,
    insightId,
    openDraftChart,
  ]);

  // A new-chart request made before the suggestions finish computing opens the
  // draft as soon as they land, or clears itself if none can be suggested.
  useEffect(() => {
    if (newChartRequestedFor !== insightId) return;
    const target = resolvePendingNewChartTarget({
      requestedInsightId: newChartRequestedFor,
      currentInsightId: insightId,
      suggestionsReady: areChartSuggestionsReady,
      firstSuggestedChartType: firstChartSuggestion?.chartType,
    });
    if (!target && !areChartSuggestionsReady) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setNewChartRequestedFor(null);
      if (target) openDraftChart(target.chartType);
    });
    return () => {
      cancelled = true;
    };
  }, [
    areChartSuggestionsReady,
    firstChartSuggestion,
    insightId,
    newChartRequestedFor,
    openDraftChart,
  ]);

  const canvasTabItems = useMemo<WorkbenchTabItem[]>(() => {
    const tabs: WorkbenchTabItem[] = [
      {
        id: DATA_TAB_ID,
        label: "Data",
        icon: <TableIcon className="size-3.5" />,
        pinned: "start",
      },
      ...insightVisualizations.map((viz) => {
        const Icon = CHART_ICONS[viz.visualizationType];
        return {
          id: `${VIZ_TAB_PREFIX}${viz.id}`,
          label: viz.name || "Untitled chart",
          icon: <Icon className="size-3.5" />,
        };
      }),
    ];
    // One unsaved slot: dashed while it is an invitation, the draft itself
    // once a chart is open in it.
    const DraftIcon = draftChartType ? CHART_ICONS[draftChartType] : null;
    tabs.push(
      draftChartType && DraftIcon
        ? {
            id: DRAFT_TAB_ID,
            label: "Untitled chart",
            icon: <DraftIcon className="size-3.5" />,
            pinned: "end",
            unsaved: true,
          }
        : {
            id: DRAFT_TAB_ID,
            label: "Chart",
            icon: <PlusIcon className="size-3.5" />,
            pinned: "end",
            dashed: true,
          },
    );
    return tabs;
  }, [draftChartType, insightVisualizations]);

  const activeTabId = canvasViewTabId(activeView);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      if (tabId === DATA_TAB_ID) {
        setNewChartRequestedFor(null);
        handleSetActiveView(TABLE_CANVAS_VIEW);
        return;
      }
      if (tabId === DRAFT_TAB_ID) {
        handleSelectNewChart();
        return;
      }
      if (!tabId.startsWith(VIZ_TAB_PREFIX)) return;
      handleSelectVisualization(tabId.slice(VIZ_TAB_PREFIX.length));
    },
    [handleSelectNewChart, handleSelectVisualization, handleSetActiveView],
  );

  const canPinActiveChart =
    activeView.kind === "chart" && activeChartSuggestion !== undefined;
  const visualizationPane = resolveVisualizationPaneState(
    activeView,
    activeVisualization?.visualizationType,
    visualizationPaneOpen,
  );

  const hasCanvas = Boolean(dataTable && authoringTable);
  const topBarTabs = useMemo(
    () =>
      canvasTabs && hasCanvas
        ? {
            label: "Canvas views",
            tabs: canvasTabItems,
            activeId: activeTabId,
            onSelect: handleSelectTab,
            panelId: CANVAS_PANEL_ID,
            findLabel: "Find a chart",
            findEmptyLabel: "No matching charts.",
          }
        : null,
    [canvasTabs, hasCanvas, canvasTabItems, activeTabId, handleSelectTab],
  );

  // Data table not found - check after all hooks are called
  if (!dataTable || !authoringTable) {
    if (missingTable) return missingTable;
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <h2 className="text-base font-semibold text-neutral-fg">
            Couldn&apos;t find this chart&apos;s table
          </h2>
          <p className="mt-1 text-sm text-neutral-fg-subtle">
            The table it reads may have been deleted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {canvasTabs && <CanvasTopBarTabs tabs={topBarTabs} />}
      <Workbench
        data-dashframe-insight-id={insightId}
        leftOpen={insightPaneOpen}
        rightOpen={visualizationPane.attached}
        left={
          <InsightConfigPanel
            pivotSortOptions={pivotSortOptions}
            pivotSortError={pivotSortError}
            onPivotSortRetry={retryPivotSort}
            insight={insight}
            dataTable={authoringTable}
            allDataTables={allDataTables}
            reportId={reportId}
            columnDisplayNames={modelColumnDisplayNames}
            getVisualizationWriteStatus={getVisualizationWriteStatus}
            note={leftPaneNote}
          />
        }
        right={
          <VisualizationConfigPanel
            activeChartType={visualizationPane.chartType}
            availableChartTypes={availableVisualizationTypes}
            canChangeChartType={canChangeChartType}
            activeSuggestionEncoding={activeChartSuggestion?.encoding}
            activeVisualization={activeVisualization}
            compiledInsight={compiledInsightForEncodings}
            pivotColor={reportPivotColor(
              activeVisualization?.encoding,
              insight,
              viewerRuntime,
              modelResolvedFields,
            )}
            dataTable={authoringTable}
            availableFields={encodingAvailableFields}
            metricLabelFields={modelResolvedFields}
            availableColumns={encodingColumns.map((column) => ({
              name: column.name,
              type: column.type ?? "unknown",
            }))}
            columnDisplayNames={encodingColumnDisplayNames}
            columnAnalysis={encodingColumnAnalysis}
            encodingsError={Boolean(encodingResultError)}
            onRetryEncodings={() => {
              retryEncodingResult();
            }}
            onPendingVisualizationChange={handleVisualizationWritePendingChange}
            onSelectChartType={openDraftChart}
            updateVisualization={updateVisualization}
          />
        }
      >
        {/* Collapses by the header's own width: view labels below 48rem,
            breadcrumb below 42rem, action labels below 36rem. Under ~23rem
            (both panes open on a small window) it scrolls rather than clip. */}
        <header className="@container flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto px-1 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0 [&>input]:shrink">
          <WorkbenchPaneToggle
            side="left"
            open={insightPaneOpen}
            paneName="Insight"
            onToggle={toggleInsightPane}
          />
          {header({
            activeView,
            activeVisualization,
            insightVisualizations,
            canPinActiveChart,
            pinActiveChart: handlePinActiveChart,
            ensureActiveVisualization,
          })}
          {visualizationPane.available && (
            <WorkbenchPaneToggle
              side="right"
              open={visualizationPane.attached}
              paneName="Visualization"
              onToggle={toggleVisualizationPane}
            />
          )}
        </header>

        {activeView.kind !== "chart" && (
          <ReportSwitchers
            insight={insight}
            fields={modelResolvedFields}
            runtime={viewerRuntime}
            onChange={(runtime) => setViewerState({ id: insightId, runtime })}
          />
        )}
        <InsightCanvasWell
          insight={activeView.kind === "chart" ? undefined : displayInsight}
          result={
            activeView.kind === "chart"
              ? chartSuggestionResult
              : savedInsightResult
          }
          showChart={activeView.kind !== "table"}
        >
          {activeView.kind === "chart" && (
            <EphemeralChartCanvas
              detailRowsOnly={chartSuggestionResult.schema.some(
                (column) => column.id === "__report_grouping",
              )}
              tableName={chartSuggestionFrameId ?? undefined}
              suggestion={activeChartSuggestion}
              isLoading={!areChartSuggestionsReady}
              error={chartSuggestionResult.error}
              onRetry={chartSuggestionResult.retry}
              onRegenerate={handleRegenerate}
            />
          )}
          {activeView.kind === "visualization" && activeVisualization && (
            <VisualizationPreview
              visualization={{
                ...activeVisualization,
                encoding: reportEncoding(
                  activeVisualization.encoding ?? {},
                  insight,
                  viewerRuntime,
                  modelResolvedFields,
                ),
              }}
              height="container"
              thumbnail={false}
              columnDisplayNames={encodingColumnDisplayNames}
              // Same primitive and host message as the result table below, so
              // both halves of the workbench agree. Only set on error — the
              // encoding-missing case keeps the preview's own terminal text.
              fallback={
                savedInsightResult.error ? (
                  <InsightResultErrorState
                    error={savedInsightResult.error}
                    onRetry={savedInsightResult.retry}
                    className="h-full"
                  />
                ) : undefined
              }
              materialization={{
                insight: displayInsight,
                runtime: viewerRuntime,
                dataTable: authoringTable,
                dataFrameId: savedInsightResult.dataFrameId,
                isReady: savedInsightResult.isReady,
                error: savedInsightResult.error,
                resolvedFields: savedInsightResult.resolvedFields,
              }}
            />
          )}
        </InsightCanvasWell>
      </Workbench>
    </>
  );
}
