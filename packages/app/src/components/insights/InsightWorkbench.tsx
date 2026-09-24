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
import {
  Workbench,
  WorkbenchPaneToggle,
  useWorkbenchPanes,
} from "@/components/workbench/Workbench";
import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { getVisualizationTypeChange } from "@/components/visualizations/visualization-type-change";
import {
  buildInsightSourceRevision,
  resolveInsightSourceDataTable,
  useInsightPagination,
} from "@/hooks/useInsightPagination";
import { formatCellValue } from "@/lib/cell-formatter";
import { buildInsightColumnDisplayNames } from "@/lib/insight-column-display-names";
import { resolveInsightAuthoringTable } from "@/lib/insights/compute-combined-fields";
import {
  sanitizeInsightCanvasView,
  type InsightCanvasView,
} from "@/lib/insights/canvas-view";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import { suggestChartStarters } from "@/lib/visualizations/chart-starter";
import { validateEncoding } from "@/lib/visualizations/encoding-enforcer";
import { api } from "@dashframe/convex-backend/api";
import { buildInsightAvailableFields } from "@dashframe/engine";
import type {
  ColumnAnalysis,
  CompiledInsight,
  DataTable,
  Field,
  Insight,
  InsightRuntimeInput,
  UUID,
  Visualization,
  VisualizationType,
} from "@dashframe/types";
import { buildVisualizationUpdateCommands } from "@dashframe/types";
import { VirtualTable, type VirtualTableColumnConfig } from "@dashframe/ui";

import { cn, ErrorState } from "@wystack/ui-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChartStarter, type ChartStarterSample } from "./ChartStarter";
import { InsightConfigPanel } from "./config-panel";
import { isPlainSumColumn } from "./config-panel/MetricsSection";
import {
  INSIGHT_CANVAS_CHART_TYPES,
  VisualizationConfigPanel,
} from "./VisualizationConfigPanel";

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

function resolveVisualizationPaneState(
  activeView: InsightCanvasView,
  activeVisualizationType: VisualizationType | undefined,
  paneOpen: boolean,
) {
  const available = activeView.kind !== "table";
  return {
    available,
    attached: available && paneOpen,
    chartType: activeVisualizationType ?? "barY",
  };
}

type InsightPaginationResult = ReturnType<typeof useInsightPagination>;

/** Runtime output — a stack, a WASM or engine error — is not copy. */
const RUNTIME_OUTPUT = /\n|\bat \S+ \(|\b\w*(?:Error|Exception):/;
const RUNTIME_NAMES = /wasm|emscripten/i;

const UNREADABLE_RESULT_COPY =
  "The data for this chart couldn't be read. Try again, or check its data source.";

/**
 * What a result failure says. The host writes its failures for people, but
 * nothing reaches the screen that reads as runtime output: that becomes plain
 * copy, and the error state's Retry is the way out.
 */
export function resultErrorCopy(error: string): string {
  return RUNTIME_OUTPUT.test(error) || RUNTIME_NAMES.test(error)
    ? UNREADABLE_RESULT_COPY
    : error;
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
  starter,
  children,
}: {
  insight?: Insight;
  result: InsightPaginationResult;
  showChart: boolean;
  /** An empty chart's starting points, shown instead of the result table. */
  starter?: ReactNode;
  children: ReactNode;
}) {
  const [resultCollapsed, setResultCollapsed] = useState(false);
  let content: ReactNode;
  if (starter && !showChart) {
    content = (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg p-3 shadow-[var(--surface-shadow)] dark:bg-neutral-bg-subtle">
        {starter}
      </div>
    );
  } else if (showChart) {
    content = (
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
    );
  } else {
    content = (
      <InsightResultTable
        insight={insight}
        result={result}
        className="flex-1"
      />
    );
  }
  return (
    <div
      aria-label="Canvas"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg-muted p-2 shadow-inner dark:bg-neutral-bg-dim"
    >
      {content}
    </div>
  );
}

export interface InsightWorkbenchProps {
  insight: Insight;
  /** What the canvas shows; a chart that no longer exists shows the data. */
  view: InsightCanvasView;
  /** Header contents between the pane toggles: identity and actions. */
  header: ReactNode;
  /** One line under the left pane's title. */
  leftPaneNote?: ReactNode;
  /** Shown instead of the workbench when the insight's table is gone. */
  missingTable?: ReactNode;
  /**
   * A new chart: while its canvas shows the table, it offers suggested charts
   * and column actions. Called with the chart type a picked suggestion plots,
   * and with `undefined` when writing that pick fails.
   */
  starter?: {
    onPickChartType?: (chartType: VisualizationType | undefined) => void;
  };
}

/**
 * The insight workbench: the query on the left, the chart and its result in
 * the centre, the chart's encodings on the right. Route-free: the host owns
 * the page around it, which view is open, and the header's contents.
 */
export function InsightWorkbench({
  insight,
  view,
  header,
  leftPaneNote,
  missingTable,
  starter,
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
  const visualizationIds = useMemo(
    () => new Set(insightVisualizations.map((viz) => viz.id)),
    [insightVisualizations],
  );
  const activeView = useMemo(
    () => sanitizeInsightCanvasView(view, visualizationIds),
    [view, visualizationIds],
  );
  const activeVisualization =
    activeView.kind === "visualization"
      ? insightVisualizations.find(
          (viz) => viz.id === activeView.visualizationId,
        )
      : undefined;

  // WebMCP reads which insight is open, and what its canvas shows, from here.
  const setWebMCPInsight = useWebMCPPageStore((state) => state.setInsight);
  const clearWebMCPInsight = useWebMCPPageStore((state) => state.clearInsight);
  const updateWebMCPInsight = useWebMCPPageStore(
    (state) => state.updateInsight,
  );
  useEffect(() => {
    setWebMCPInsight({ insightId });
    return () => clearWebMCPInsight(insightId);
  }, [clearWebMCPInsight, insightId, setWebMCPInsight]);
  useEffect(() => {
    updateWebMCPInsight(insightId, { activeView });
  }, [activeView, insightId, updateWebMCPInsight]);

  const savedInsightResult = useInsightEncodingMetadata(
    insight,
    true,
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
      ...encodingRenderedColumnDisplayNames,
    };
    for (const column of encodingColumns) {
      displayNames[column.name] ??= column.name;
    }
    return displayNames;
  }, [
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
    if (!activeVisualization) return new Set<VisualizationType>();
    if (!areEncodingsReady) {
      return new Set([activeVisualization.visualizationType]);
    }
    return new Set(
      INSIGHT_CANVAS_CHART_TYPES.filter((chartType) =>
        canChangeChartType(activeVisualization, chartType),
      ),
    );
  }, [activeVisualization, areEncodingsReady, canChangeChartType]);

  // The rows the new chart opened on. Kept through a partial pick, which
  // groups the result, so the preview and its header actions stay put.
  const pristine =
    insight.selectedFields.length === 0 && (insight.metrics ?? []).length === 0;
  const [starterSample, setStarterSample] = useState<
    (ChartStarterSample & { insightId: string }) | null
  >(null);
  // Rows of a result with picks in it. Right after the picks are removed the
  // result still holds them until the new run lands; never snapshot those.
  const [pickedRows, setPickedRows] = useState<unknown>(null);
  if (!pristine && pickedRows !== encodingRows) setPickedRows(encodingRows);
  if (
    starter &&
    pristine &&
    areEncodingsReady &&
    encodingRows !== pickedRows &&
    (starterSample?.insightId !== insightId ||
      starterSample.rows !== encodingRows)
  ) {
    setStarterSample({
      insightId,
      schema: encodingSchema,
      rows: encodingRows,
      totalCount: encodingRowCount,
      analysis: encodingColumnAnalysis,
    });
  }
  const sample = starterSample?.insightId === insightId ? starterSample : null;
  const starterSuggestions = useMemo(
    () =>
      sample
        ? suggestChartStarters(
            authoringTable?.fields ?? [],
            sample.analysis,
            sample.totalCount,
            {
              // Every candidate: a card that turns out not to fit gives way
              // to the next one.
              limit: Infinity,
              canSum: (field) =>
                !!authoringTable &&
                !!field.columnName &&
                isPlainSumColumn(authoringTable, field.columnName),
            },
          )
        : [],
    [authoringTable, sample],
  );
  const sourceRevision = useMemo(
    () => buildInsightSourceRevision(insight, allDataTables, allInsights),
    [allDataTables, allInsights, insight],
  );

  const visualizationPane = resolveVisualizationPaneState(
    activeView,
    activeVisualization?.visualizationType,
    visualizationPaneOpen,
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
          updateVisualization={updateVisualization}
        />
      }
    >
      {/* Collapses by the header's own width. Under ~23rem (both panes open
          on a small window) it scrolls rather than clip. */}
      <header className="@container flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto px-1 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0 [&>input]:shrink">
        <WorkbenchPaneToggle
          side="left"
          open={insightPaneOpen}
          paneName="Insight"
          onToggle={toggleInsightPane}
        />
        {header}
        {visualizationPane.available && (
          <WorkbenchPaneToggle
            side="right"
            open={visualizationPane.attached}
            paneName="Visualization"
            onToggle={toggleVisualizationPane}
          />
        )}
      </header>

      <ReportSwitchers
        insight={insight}
        fields={modelResolvedFields}
        runtime={viewerRuntime}
        onChange={(runtime) => setViewerState({ id: insightId, runtime })}
      />
      <InsightCanvasWell
        insight={displayInsight}
        result={savedInsightResult}
        showChart={activeView.kind === "visualization"}
        starter={
          // A failed run shows the result's error and retry, not rows from
          // an earlier run.
          starter &&
          sample &&
          !encodingResultError &&
          starterSuggestions.length > 0 ? (
            <ChartStarter
              insight={insight}
              dataTable={authoringTable}
              sample={sample}
              suggestions={pristine ? starterSuggestions : []}
              sourceRevision={sourceRevision}
              columnDisplayNames={encodingColumnDisplayNames}
              onPickChartType={starter.onPickChartType}
            />
          ) : undefined
        }
      >
        {activeVisualization && (
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
  );
}
