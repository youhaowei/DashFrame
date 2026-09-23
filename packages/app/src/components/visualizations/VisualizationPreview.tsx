import {
  buildChartPresentation,
  resolveReportChartEncoding,
} from "@/lib/insights/chart-presentation";
import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import { api } from "@dashframe/convex-backend/api";
import { getMetricDisplayLabel, reportMeasureFormats } from "@dashframe/engine";
import type {
  ChartEncoding,
  DataTable,
  Field,
  Insight,
  InsightRuntimeInput,
  InsightPresentation,
  Visualization,
} from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { Chart } from "@dashframe/visualization";

import { Spinner } from "@wystack/ui-react";
import { useMemo } from "react";

import { VisualizationErrorBoundary } from "./VisualizationErrorBoundary";

/** Axis and legend titles: the field or measure name, never a column alias. */
function encodingLabel(
  value: string | undefined,
  fields: readonly Field[],
  metrics: Insight["metrics"],
): string | undefined {
  const parsed = parseEncoding(value);
  if (parsed?.type === "field") {
    return fields.find((field) => field.id === parsed.id)?.name;
  }
  if (parsed?.type === "metric") {
    const metric = metrics.find((candidate) => candidate.id === parsed.id);
    return metric ? getMetricDisplayLabel(metric, [...fields]) : undefined;
  }
  return undefined;
}

const PREVIEW_HEIGHT = 200; // px

function PreviewLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-bg-muted/30">
      <Spinner size="lg" className="text-neutral-fg-subtle" />
    </div>
  );
}

interface VisualizationPreviewProps {
  /** The visualization to preview */
  visualization: Visualization;
  /** Height of the preview in pixels, or fill its container (default: 200) */
  height?: number | "container";
  /** Fallback element to show when data can't be loaded */
  fallback?: React.ReactNode;
  /**
   * Draw the chart as a card thumbnail, without axes, legends or padding
   * (default). Pass false where the chart is the thing being read, such as
   * the insight workbench canvas.
   */
  thumbnail?: boolean;
  /** Reuse a parent materialization when the preview sits beside its table. */
  materialization?: {
    insight: Insight;
    dataTable?: DataTable;
    dataFrameId: string | null;
    isReady: boolean;
    error: string | null;
    resolvedFields: Field[];
    runtime?: InsightRuntimeInput;
  };
}

/**
 * Renders a visualization from its saved Insight. By default it is a card
 * thumbnail: Chart's preview mode, with no axes, legends, or padding. Pass
 * `thumbnail={false}` where the chart is read at full size, as on the insight
 * workbench canvas, to draw axes with readable titles.
 *
 * This component is self-contained: it fetches the insight and creates
 * the DuckDB view if needed using useInsightView. This unifies the approach
 * with insight detail pages - same hook, same caching, same view creation.
 *
 * The boundary lives HERE rather than at each callsite so no consumer can
 * mount a preview without containment: the home page renders three of these,
 * and before the boundary one bad encoding replaced that whole page (GH #289).
 * A boundary cannot catch its own render, hence the inner component.
 */
export function VisualizationPreview(props: VisualizationPreviewProps) {
  return (
    <VisualizationErrorBoundary
      resetKey={`${props.visualization.id}:${props.visualization.updatedAt ?? ""}`}
    >
      {props.materialization ? (
        <SharedVisualizationPreview
          {...props}
          materialization={props.materialization}
        />
      ) : (
        <VisualizationPreviewContent {...props} />
      )}
    </VisualizationErrorBoundary>
  );
}

function SharedVisualizationPreview(
  props: VisualizationPreviewProps & {
    materialization: NonNullable<VisualizationPreviewProps["materialization"]>;
  },
) {
  const provided = props.materialization;
  const presentation = buildChartPresentation(
    provided.insight,
    props.visualization.encoding,
    props.visualization.visualizationType,
  );
  return presentation ? (
    <ChartPresentationPreview {...props} presentation={presentation} />
  ) : (
    <ResolvedVisualizationPreview
      {...props}
      insight={provided.insight}
      dataTable={provided.dataTable}
      instanceAwareFields={provided.resolvedFields}
      viewName={provided.dataFrameId}
      isReady={provided.isReady}
      error={provided.error}
      isLoadingInsight={false}
    />
  );
}
function ChartPresentationPreview(
  props: VisualizationPreviewProps & {
    materialization: NonNullable<VisualizationPreviewProps["materialization"]>;
    presentation: InsightPresentation;
  },
) {
  const provided = props.materialization;
  const result = useInsightPagination({
    insight: provided.insight,
    showModelPreview: false,
    enabled: provided.isReady,
    runtime: provided.runtime,
    presentation: props.presentation,
  });
  return (
    <ResolvedVisualizationPreview
      {...props}
      insight={provided.insight}
      dataTable={provided.dataTable}
      instanceAwareFields={result.resolvedFields}
      viewName={result.dataFrameId}
      isReady={provided.isReady && result.isReady}
      error={provided.error ?? result.error}
      isLoadingInsight={false}
      presentationApplied
    />
  );
}

function VisualizationPreviewContent({
  visualization,
  height = PREVIEW_HEIGHT,
  fallback = null,
  thumbnail = true,
}: VisualizationPreviewProps) {
  // Fetch the insight for this visualization
  const { data: insight, isLoading: isLoadingInsight } = queryStatus(
    useQuery({
      query: api.app.getInsight,
      args: { id: visualization.insightId },
    }),
  );

  // Fetch data tables for encoding resolution
  const { data: dataTables = [] } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );

  // Find the data table for this insight (React Compiler memoizes this).
  const dataTable =
    insight?.source.sourceType === "dataTable"
      ? dataTables.find((t) => t.id === insight.source.sourceId)
      : undefined;

  // Build a minimal insight shape for hook consumption (joins only; no
  // selectedFields/metrics/filters — preview renders raw model data).
  const insightForView = useMemo((): Insight | null => {
    if (!insight) return null;
    return {
      id: insight.id,
      name: insight.name,
      source: insight.source,
      joins: insight.joins,
    } as Insight;
  }, [insight]);

  // Resolve the saved Insight's current immutable server frame for Mosaic.
  const presentation = useMemo(
    () =>
      buildChartPresentation(
        insight,
        visualization.encoding,
        visualization.visualizationType,
      ),
    [insight, visualization.encoding, visualization.visualizationType],
  );
  const { viewName, isReady, error } = useInsightView(insight, {
    presentation,
  });

  // Resolve instance-qualified fields for repeat-join insights so that
  // field:<uuid>_j1 encodings resolve to their SQL alias correctly.
  const { resolvedFields: instanceAwareFields } = useInsightPagination({
    insight:
      insightForView ??
      ({ source: { sourceType: "dataTable", sourceId: "" } } as Insight),
    showModelPreview: false,
    enabled: !!insightForView,
    presentation,
  });

  return (
    <ResolvedVisualizationPreview
      visualization={visualization}
      height={height}
      fallback={fallback}
      thumbnail={thumbnail}
      insight={insight}
      dataTable={dataTable}
      instanceAwareFields={instanceAwareFields}
      viewName={viewName}
      isReady={isReady}
      error={error}
      isLoadingInsight={isLoadingInsight}
      presentationApplied={Boolean(presentation)}
    />
  );
}

function ResolvedVisualizationPreview({
  visualization,
  height = PREVIEW_HEIGHT,
  fallback = null,
  thumbnail = true,
  insight,
  dataTable,
  instanceAwareFields,
  viewName,
  isReady,
  error,
  isLoadingInsight,
  presentationApplied = false,
}: Pick<
  VisualizationPreviewProps,
  "visualization" | "height" | "fallback" | "thumbnail"
> & {
  insight: Insight | null | undefined;
  dataTable: DataTable | undefined;
  instanceAwareFields: Field[];
  viewName: string | null;
  isReady: boolean;
  error: string | null;
  isLoadingInsight: boolean;
  presentationApplied?: boolean;
}) {
  // Resolve encoding against the saved Insight's materialized result frame.
  // - field:<uuid> → column name (e.g., "Product")
  // - metric:<uuid> → computed result alias (e.g., "metric_<uuid>")
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (
      !visualization.encoding ||
      !insight ||
      (!dataTable && instanceAwareFields.length === 0)
    ) {
      return {};
    }

    // Build resolution context with fields and metrics.
    // For repeat-joins, instanceAwareFields carries synthetic fields with
    // instance-suffixed IDs (e.g. `<uuid>_j1`) that match the SQL aliases
    // the model view emits. Fall back to bare table fields before the hook
    // resolves (initial render) or when there are no joins.
    const context = {
      fields:
        instanceAwareFields.length > 0
          ? instanceAwareFields
          : (dataTable?.fields ?? []),
      metrics: insight.metrics ?? [],
    };

    // Resolve prefixed IDs to SQL expressions
    const resolved = resolveReportChartEncoding(
      visualization.encoding,
      context,
      presentationApplied,
      visualization.visualizationType,
    );

    return {
      ...resolved,
      xType: visualization.encoding.xType,
      yType: visualization.encoding.yType,
      // Pass through date transforms for temporal bar charts
      xTransform: visualization.encoding.xTransform,
      yTransform: visualization.encoding.yTransform,
      xLabel: encodingLabel(
        visualization.encoding.x,
        context.fields,
        context.metrics,
      ),
      yLabel: encodingLabel(
        visualization.encoding.y,
        context.fields,
        context.metrics,
      ),
      colorLabel: encodingLabel(
        visualization.encoding.color,
        context.fields,
        context.metrics,
      ),
      sizeLabel: encodingLabel(
        visualization.encoding.size,
        context.fields,
        context.metrics,
      ),
    };
  }, [
    visualization.encoding,
    visualization.visualizationType,
    dataTable,
    insight,
    instanceAwareFields,
    presentationApplied,
  ]);

  // Error state — checked BEFORE the loading guard so that view-creation errors
  // that leave `isReady=false` reach a terminal UI instead of spinning forever.
  //
  // Guard: `!isLoadingInsight` prevents stale-error bleed-through. When the
  // visualization prop changes to a new insight that is still loading, the prior
  // useInsightView error persists briefly (the hook resets it only when
  // createView succeeds). Without this guard, a stale error from insight A
  // would flash "Failed to load" while insight B is being fetched.
  if (!isLoadingInsight && error) {
    return (
      fallback ?? (
        <div className="flex h-full w-full items-center justify-center bg-neutral-bg-muted/50 text-xs text-neutral-fg-subtle">
          <span>Failed to load</span>
        </div>
      )
    );
  }

  // Loading state — waiting for insight data or view creation.
  // Only reached when there is no error (or isLoadingInsight is true, in which
  // case any prior error is stale and the spinner is the correct state).
  if (isLoadingInsight || !isReady || !viewName) {
    return <PreviewLoading />;
  }

  // Check if encoding has required data channels (x or y)
  // Visualizations created before the encoding fix may be missing these
  const hasValidEncoding = resolvedEncoding.x || resolvedEncoding.y;

  // Show distinct terminal UI for missing encoding — callers that omit `fallback`
  // get the inline "Encoding missing" text here, not a spinner.
  if (!hasValidEncoding) {
    return (
      fallback ?? (
        <div className="flex h-full w-full items-center justify-center bg-neutral-bg-muted/50 text-xs text-neutral-fg-subtle">
          <span>Encoding missing</span>
        </div>
      )
    );
  }

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ height: height === "container" ? "100%" : height }}
    >
      <Chart
        detailRowsOnly={Boolean(
          !presentationApplied &&
          insight?.reporting?.totals &&
          insight.selectedFields.length &&
          insight.metrics.length,
        )}
        tableName={viewName}
        visualizationType={visualization.visualizationType}
        encoding={resolvedEncoding}
        measureFormats={reportMeasureFormats(insight)}
        width="container"
        height="container"
        preview={thumbnail}
        className="h-full w-full"
      />
    </div>
  );
}
