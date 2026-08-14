import { useChartEngine } from "@/components/providers/ChartEngineProvider";
import {
  resolveInsightSourceDataTable,
  useInsightPagination,
} from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import { api } from "@/wystack/api";
import {
  getMetricDisplayLabel,
  resolveEncodingToResultFrame,
} from "@dashframe/engine";
import type {
  ChartEncoding,
  DashboardItemOverrides,
  DataTable,
  Insight,
  InsightRuntimeInput,
  Visualization,
} from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { VirtualTable, type VirtualTableColumnConfig } from "@dashframe/ui";
import { Chart, useVisualization } from "@dashframe/visualization";
import { useQuery } from "@wystack/client";
import { ErrorState, Spinner, Surface, Toggle } from "@wystack/ui-react";
import { ChartIcon, LayersIcon, TableIcon } from "@wystack/ui-react/icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EngineUnavailableState } from "./EngineUnavailableState";
import { VisualizationErrorBoundary } from "./VisualizationErrorBoundary";

// Minimum visible rows needed to enable "Show Both" mode
const MIN_VISIBLE_ROWS_FOR_BOTH = 5;

type DashboardRuntimeResolution = {
  runtime?: InsightRuntimeInput;
  error?: string;
};

function resolveRuntimeFilters(
  insight: Insight,
  overrides: NonNullable<DashboardItemOverrides["filters"]>,
): DashboardRuntimeResolution {
  const values: Record<string, unknown> = {};
  for (const override of overrides) {
    const declaration = insight.runtimeControls?.filters?.find(
      (candidate) => candidate.filterId === override.id,
    );
    if (!declaration) {
      return { error: "This dashboard filter is not declared by the Insight." };
    }
    values[declaration.key] = override.cleared ? null : override.value;
  }
  return { runtime: { filters: values } };
}

function resolveRuntimeSorts(
  insight: Insight,
  dataTables: readonly DataTable[],
  overrides: NonNullable<DashboardItemOverrides["sorts"]>,
): DashboardRuntimeResolution {
  const declaration = insight.runtimeControls?.sort;
  if (!declaration) {
    return { error: "This dashboard sort is not declared by the Insight." };
  }
  const fields = dataTables.flatMap((table) => table.fields ?? []);
  const sorts = overrides.map((sort) => {
    const fieldId = declaration.allowedFieldIds.find((allowedId) => {
      if (allowedId === sort.field) return true;
      const field = fields.find((candidate) => candidate.id === allowedId);
      if (field) return (field.columnName ?? field.name) === sort.field;
      const metric = insight.metrics.find(
        (candidate) => candidate.id === allowedId,
      );
      return metric
        ? metric.name === sort.field || metric.columnName === sort.field
        : false;
    });
    return fieldId ? { fieldId, direction: sort.direction } : null;
  });
  if (sorts.some((sort) => sort === null)) {
    return {
      error: "This dashboard sort field is not allowed by the Insight.",
    };
  }
  return { runtime: { sort: sorts as InsightRuntimeInput["sort"] } };
}

/**
 * Convert legacy dashboard cell values into the saved Insight's declared
 * runtime-control surface. Undeclared mutations fail visibly instead of
 * silently changing or bypassing the canonical Insight definition.
 */
export function resolveDashboardRuntime(
  insight: Insight,
  dataTables: readonly DataTable[],
  overrides: DashboardItemOverrides | undefined,
): DashboardRuntimeResolution {
  if (!overrides) return {};
  const controls = insight.runtimeControls;
  const runtime: InsightRuntimeInput = {};

  if (overrides.filters !== undefined) {
    const resolution = resolveRuntimeFilters(insight, overrides.filters);
    if (resolution.error) return resolution;
    runtime.filters = resolution.runtime?.filters;
  }

  if (overrides.sorts !== undefined) {
    const resolution = resolveRuntimeSorts(
      insight,
      dataTables,
      overrides.sorts,
    );
    if (resolution.error) return resolution;
    runtime.sort = resolution.runtime?.sort;
  }

  if (overrides.limit !== undefined) {
    if (!controls?.limit) {
      return { error: "This dashboard limit is not declared by the Insight." };
    }
    runtime.limit = overrides.limit;
  }

  return { runtime };
}

export function VisualizationDisplay(props: VisualizationDisplayProps) {
  // Same containment as VisualizationPreview: the full-size chart resolves the
  // same untrusted encoding, so an unguarded throw here would take the
  // visualization detail route or a whole dashboard down with one bad panel
  // (GH #289).
  //
  // The reset key carries `updatedAt`, not just the id: the config panel that
  // repairs a bad encoding lives OUTSIDE this boundary, on the same route, and
  // keying on the id alone would leave the repaired chart stuck on the broken
  // card until the user navigated away. The query is the one the content
  // component already issues, so this shares its cache rather than adding a
  // fetch.
  const { data: visualizations = [] } = useQuery(api.listVisualizations, {
    args: {},
  });
  const active = visualizations.find(
    (candidate) => candidate.id === props.visualizationId,
  );

  return (
    <VisualizationErrorBoundary
      resetKey={`${props.visualizationId ?? ""}:${active?.updatedAt ?? ""}`}
    >
      <VisualizationDisplayContent {...props} />
    </VisualizationErrorBoundary>
  );
}

interface VisualizationDisplayProps {
  visualizationId?: string;
  /**
   * Per-cell param overrides from the dashboard item.  When present, the
   * rendered chart and table reflect `insight ⊕ cellOverride` rather than
   * the raw insight defaults.  Absent → no change (identical to pre-override
   * behaviour, satisfying the no-override no-regression constraint).
   */
  overrides?: DashboardItemOverrides;
}

function VisualizationDisplayContent({
  visualizationId,
  overrides,
}: VisualizationDisplayProps) {
  // Whole-engine-down signals. `engineError` is the native bootstrap failure
  // (connector never came up); `visualizationError` is the provider failing to
  // initialize its Mosaic coordinator. Both mean the same thing to the user —
  // charts can't load — and reloading is the fix, so they share one surface.
  const { engineError } = useChartEngine();
  const { error: visualizationError } = useVisualization();
  const engineUnavailable = Boolean(engineError) || Boolean(visualizationError);

  // Use effect to detect mounting (avoids hydration mismatch)
  const [isMounted, setIsMounted] = useState(false);
  const [visibleRows, setVisibleRows] = useState<number>(10);
  const [activeTab, setActiveTab] = useState<string>("both");
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Set mounted state after hydration
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const { data: visualizations = [], isLoading: isVizLoading } = useQuery(
    api.listVisualizations,
    { args: {} },
  );
  const { data: insights = [] } = useQuery(api.listInsights, { args: {} });
  const { data: dataTables = [] } = useQuery(api.listDataTables, { args: {} });

  // Get the visualization
  const activeViz = useMemo((): Visualization | null => {
    if (!visualizationId) return null;
    return visualizations.find((v) => v.id === visualizationId) ?? null;
  }, [visualizationId, visualizations]);

  // Get insight for the visualization
  const insight = useMemo(() => {
    if (!activeViz) return undefined;
    return insights.find((i) => i.id === activeViz.insightId);
  }, [activeViz, insights]);

  // Get the data table for encoding resolution
  const dataTable = useMemo(() => {
    return resolveInsightSourceDataTable(insight, dataTables, insights);
  }, [insight, dataTables, insights]);

  const dashboardRuntime = useMemo(
    () =>
      insight
        ? resolveDashboardRuntime(insight, dataTables, overrides)
        : ({} satisfies DashboardRuntimeResolution),
    [dataTables, insight, overrides],
  );

  // Use insight view hook to get the proper table name (handles joins).
  // `error` surfaces a post-bootstrap failure (e.g. native upload failed because
  // the loopback server stopped or returned 500). Without consuming it here the
  // view never becomes ready and the component would spin forever.
  //
  const {
    viewName: insightViewName,
    isReady: isInsightViewReady,
    error: insightViewError,
  } = useInsightView(dashboardRuntime.error ? null : insight, {
    runtime: dashboardRuntime.runtime,
  });

  // The table reads the same saved execution generation and declared runtime
  // values as the chart; neither surface reconstructs query semantics locally.
  const {
    fetchData,
    totalCount,
    columns,
    isReady: isPaginationReady,
    columnDisplayNames,
    resolvedFields: instanceAwareFields,
  } = useInsightPagination({
    insight,
    showModelPreview: false,
    enabled: Boolean(insight && !dashboardRuntime.error),
    runtime: dashboardRuntime.runtime,
  });

  // Helper to calculate visible rows from container dimensions
  const calculateVisibleRows = () => {
    if (!containerRef.current || !headerRef.current) return null;
    const containerHeight = containerRef.current.clientHeight;
    if (containerHeight < 100) return null; // Layout not ready

    const headerHeight = headerRef.current.offsetHeight || 60;
    const contentPadding = 20; // mt-3 + gap

    // Table gets max 40% of the available content area
    const availableContentHeight =
      containerHeight - headerHeight - contentPadding;
    const maxTableHeight = Math.floor(availableContentHeight * 0.4);

    const rowHeight = 36;
    const tableHeaderHeight = 40;
    return Math.max(
      0,
      Math.floor((maxTableHeight - tableHeaderHeight) / rowHeight),
    );
  };

  // Watch container size changes to detect available space for "Show Both" mode
  const isDataReady = !!activeViz && isPaginationReady;

  // Immediate measurement on layout (before paint) to set correct initial tab
  useLayoutEffect(() => {
    if (!isDataReady) return;
    const rows = calculateVisibleRows();
    if (rows !== null) {
      requestAnimationFrame(() => setVisibleRows(rows));
    }
  }, [isDataReady]);

  // Continue watching for resize changes
  useEffect(() => {
    if (!containerRef.current || !isDataReady) return;

    const observer = new ResizeObserver(() => {
      const rows = calculateVisibleRows();
      if (rows !== null) {
        requestAnimationFrame(() => setVisibleRows(rows));
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isDataReady]);

  // Get table name for chart rendering from insight view
  // The insight view is created by useInsightView and includes all joined columns with UUID aliases
  const tableName = useMemo(() => {
    if (insightViewName && isInsightViewReady) {
      return insightViewName;
    }
    return null;
  }, [insightViewName, isInsightViewReady]);

  // Resolve encoding from storage format (field:<uuid>, metric:<uuid>) to
  // columns in the saved Insight's materialized result frame.
  // This converts:
  // - field:<uuid> → column name (e.g., "category", "Product")
  // - metric:<uuid> → computed result alias (e.g., "metric_<uuid>")
  // Metrics were already aggregated by runInsight; Mosaic must not aggregate
  // their source columns again.
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (
      !activeViz?.encoding ||
      !insight ||
      (!dataTable && instanceAwareFields.length === 0)
    ) {
      return {};
    }

    // Build resolution context with fields and metrics.
    // For repeat-joins, instanceAwareFields carries synthetic fields with
    // instance-suffixed IDs (e.g. `<uuid>_j1`) that match the SQL aliases
    // DuckDB produces. Fall back to bare dataTable fields when the hook
    // hasn't resolved yet (first render or no joins).
    const resolutionFields =
      instanceAwareFields.length > 0
        ? instanceAwareFields
        : (dataTable?.fields ?? []);
    const context = {
      fields: resolutionFields,
      metrics: insight.metrics ?? [],
    };

    // Resolve prefixed IDs to SQL expressions
    const resolved = resolveEncodingToResultFrame(activeViz.encoding, context);
    const resolveColumnReference = (value: string | undefined) => {
      if (!value) return undefined;
      if (columns.some((column) => column.name === value)) return value;

      // Only fall back to the reverse lookup when exactly one alias matches.
      // columnDisplayNames is many-to-one in joined insights, so .find() can
      // bind the wrong raw column.
      const matches = Object.entries(columnDisplayNames).filter(
        ([, displayName]) => displayName === value,
      );
      return matches.length === 1 ? matches[0]![0] : value;
    };

    const x = resolveColumnReference(resolved.x);
    const y = resolveColumnReference(resolved.y);
    const color = resolveColumnReference(resolved.color);
    const size = resolveColumnReference(resolved.size);
    const getEncodingDisplayLabel = (
      encodingValue: string | undefined,
      resolvedValue: string | undefined,
    ) => {
      if (!encodingValue || !resolvedValue) return undefined;

      const parsed = parseEncoding(encodingValue);
      if (parsed?.type === "field") {
        // Prefer the disambiguated label from columnDisplayNames (keyed on the
        // SQL alias, e.g. `field_<uuid>_j1`) so repeat-join instances show
        // "User Name (approved_by)" instead of the bare "User Name" that a
        // direct field.name lookup would return.  Fall back to field.name for
        // the common case where no disambiguation entry exists (single join or
        // base-table field), then to the raw resolvedValue as a last resort.
        const disambiguated = columnDisplayNames[resolvedValue];
        if (disambiguated) return disambiguated;
        const field = resolutionFields.find((f) => f.id === parsed.id);
        return (
          field?.name ?? columnDisplayNames[resolvedValue] ?? resolvedValue
        );
      }
      if (parsed?.type === "metric") {
        const metric = insight.metrics?.find((m) => m.id === parsed.id);
        return metric
          ? getMetricDisplayLabel(metric, resolutionFields)
          : (columnDisplayNames[resolvedValue] ?? resolvedValue);
      }

      return columnDisplayNames[resolvedValue] ?? encodingValue;
    };

    return {
      ...resolved,
      x,
      y,
      color,
      size,
      xType: activeViz.encoding.xType,
      yType: activeViz.encoding.yType,
      // Pass through date transforms for temporal bar charts
      // These tell the renderer to use band scale (suppresses vgplot warning)
      xTransform: activeViz.encoding.xTransform,
      yTransform: activeViz.encoding.yTransform,
      // Include human-readable axis labels for chart display
      xLabel: getEncodingDisplayLabel(activeViz.encoding.x, x),
      yLabel: getEncodingDisplayLabel(activeViz.encoding.y, y),
      colorLabel: getEncodingDisplayLabel(activeViz.encoding.color, color),
      sizeLabel: getEncodingDisplayLabel(activeViz.encoding.size, size),
    };
  }, [
    activeViz,
    dataTable,
    insight,
    columns,
    columnDisplayNames,
    instanceAwareFields,
  ]);

  // Build column configs for VirtualTable to show human-readable headers
  const columnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    return columns.map((col) => ({
      id: col.name,
      label: columnDisplayNames[col.name] ?? col.name,
    }));
  }, [columns, columnDisplayNames]);

  // Get human-readable display name for color encoding
  const colorDisplayName = useMemo(() => {
    const colorEncoding = activeViz?.encoding?.color;
    const parsed = parseEncoding(colorEncoding);
    if (parsed?.type === "field") {
      const effectiveFields =
        instanceAwareFields.length > 0
          ? instanceAwareFields
          : (dataTable?.fields ?? []);
      const field = effectiveFields.find((f) => f.id === parsed.id);
      return field?.name ?? columnDisplayNames[resolvedEncoding.color ?? ""];
    }
    if (parsed?.type === "metric") {
      const metric = insight?.metrics?.find((m) => m.id === parsed.id);
      return metric
        ? getMetricDisplayLabel(metric, dataTable?.fields)
        : undefined;
    }
    if (!resolvedEncoding.color) return null;
    return columnDisplayNames[resolvedEncoding.color] ?? resolvedEncoding.color;
  }, [
    activeViz?.encoding?.color,
    dataTable?.fields,
    insight?.metrics,
    resolvedEncoding.color,
    columnDisplayNames,
    instanceAwareFields,
  ]);

  // Check if there's enough space to show both views
  const canShowBoth = visibleRows >= MIN_VISIBLE_ROWS_FOR_BOTH;
  const bothTooltip = canShowBoth
    ? "Show chart and table simultaneously"
    : `Not enough space (${visibleRows} visible rows). Need at least ${MIN_VISIBLE_ROWS_FOR_BOTH} rows.`;

  // Automatically switch to "chart" when space becomes insufficient
  const previousCanShowBothRef = useRef(canShowBoth);
  useEffect(() => {
    const prevCanShowBoth = previousCanShowBothRef.current;

    // Only react to canShowBoth changing from true to false
    if (prevCanShowBoth && !canShowBoth && activeTab === "both") {
      requestAnimationFrame(() => setActiveTab("chart"));
    }

    previousCanShowBothRef.current = canShowBoth;
  }, [canShowBoth, activeTab]);

  // Whole-engine-down: show the persistent inline affordance where the chart
  // would render. This takes precedence over loading/per-chart states — when
  // the engine is unreachable there's nothing to load and no chart to compute,
  // so spinning or surfacing a per-chart error would be misleading. The user
  // gets a Reload button (the actual fix) instead of instruction-as-homework.
  if (isMounted && engineUnavailable) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <EngineUnavailableState className="w-full max-w-lg" />
      </div>
    );
  }

  if (isMounted && dashboardRuntime.error) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <ErrorState
          title="Dashboard control is not available"
          description={dashboardRuntime.error}
          className="w-full max-w-lg"
        />
      </div>
    );
  }

  // Surface a post-bootstrap insight-view failure instead of spinning forever.
  // When the native upload fails at runtime (loopback server stopped, auth
  // expired, native registration 500), useInsightView sets `error` and never
  // flips `isReady` — without this branch isWaitingForData stays true and the
  // user sees an indefinite spinner. Show the error so the failure is visible.
  if (isMounted && insightViewError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <ErrorState
          title="Failed to load visualization data"
          description={insightViewError}
          className="w-full max-w-lg"
        />
      </div>
    );
  }

  // Show loading when not mounted, loading visualization, or waiting for data to be ready
  const isWaitingForData =
    (visualizationId && !activeViz) ||
    isVizLoading ||
    !isInsightViewReady ||
    !isPaginationReady;

  if (!isMounted || isWaitingForData) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <Surface
          elevation="inset"
          className="w-full max-w-lg rounded-3xl p-10 text-center"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-palette-primary/10 text-palette-primary">
            <Spinner size="lg" />
          </div>
          <p className="text-lg font-semibold text-neutral-fg">
            Loading visualization...
          </p>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            Please wait while the data is being loaded.
          </p>
        </Surface>
      </div>
    );
  }

  // No visualization selected
  if (!activeViz) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <Surface
          elevation="inset"
          className="w-full max-w-lg rounded-3xl p-10 text-center"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-palette-primary/10 text-palette-primary">
            <ChartIcon className="h-6 w-6" />
          </div>
          <p className="text-lg font-semibold text-neutral-fg">
            No visualization yet
          </p>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            Use the controls on the left to create or select a visualization to
            preview.
          </p>
        </Surface>
      </div>
    );
  }

  // Unified toggle view with Chart, Table, and Both options
  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <div
        ref={headerRef}
        className="border-b border-neutral-border/60 px-4 py-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xl font-semibold text-neutral-fg">
              {activeViz.name}
            </p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-neutral-fg-subtle">
                {totalCount.toLocaleString()} rows • {columns.length} columns
              </p>
              {colorDisplayName && (
                <span className="rounded-full bg-neutral-bg-muted px-2 py-0.5 text-xs text-neutral-fg-subtle">
                  Color: {colorDisplayName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              variant="outline"
              size="sm"
              value={activeTab}
              onValueChange={setActiveTab}
              className="shrink-0"
              options={[
                {
                  value: "chart",
                  icon: <ChartIcon className="h-3.5 w-3.5" />,
                  label: "Chart",
                },
                {
                  value: "table",
                  icon: <TableIcon className="h-3.5 w-3.5" />,
                  label: "Table",
                },
                {
                  value: "both",
                  icon: <LayersIcon className="h-3.5 w-3.5" />,
                  label: "Both",
                  disabled: !canShowBoth,
                  tooltip: bothTooltip,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {activeTab === "chart" && tableName && (
        <div className="mt-3 min-h-0 flex-1 overflow-hidden px-4 pb-8">
          <Chart
            tableName={tableName}
            visualizationType={activeViz.visualizationType}
            encoding={resolvedEncoding}
            className="h-full w-full"
          />
        </div>
      )}

      {activeTab === "table" && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col px-4">
          <Surface
            elevation="inset"
            className="flex min-h-0 flex-1 flex-col p-4"
          >
            <VirtualTable
              columns={columns}
              onFetchData={fetchData}
              columnConfigs={columnConfigs}
              height="100%"
              className="flex-1"
            />
          </Surface>
        </div>
      )}

      {activeTab === "both" && tableName && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Chart takes 60% of space */}
          <div className="h-[60%] min-h-[200px] overflow-hidden px-4 pb-4">
            <Chart
              tableName={tableName}
              visualizationType={activeViz.visualizationType}
              encoding={resolvedEncoding}
              className="h-full w-full"
            />
          </div>
          {/* Table capped at 40% of space */}
          <div className="flex h-[40%] max-h-[40%] min-h-0 flex-col overflow-hidden px-4">
            <Surface
              elevation="inset"
              className="flex min-h-0 flex-1 flex-col p-4"
            >
              <VirtualTable
                columns={columns}
                onFetchData={fetchData}
                columnConfigs={columnConfigs}
                height="100%"
                className="flex-1"
              />
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}
