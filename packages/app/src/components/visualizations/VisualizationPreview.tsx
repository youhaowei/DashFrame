import { useInsightPagination } from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import { useDataTables, useInsight } from "@dashframe/core";
import { resolveEncodingToSql } from "@dashframe/engine";
import type { ChartEncoding, Insight, Visualization } from "@dashframe/types";
import { Chart } from "@dashframe/visualization";
import { Spinner } from "@wystack/ui";
import { useMemo } from "react";

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
  /** Height of the preview in pixels (default: 200) */
  height?: number;
  /** Fallback element to show when data can't be loaded */
  fallback?: React.ReactNode;
}

/**
 * Renders a small preview of a visualization for use in cards and lists.
 *
 * Uses Chart with preview mode enabled for minimal chrome
 * (no axes, legends, or padding).
 *
 * This component is self-contained: it fetches the insight and creates
 * the DuckDB view if needed using useInsightView. This unifies the approach
 * with insight detail pages - same hook, same caching, same view creation.
 */
export function VisualizationPreview({
  visualization,
  height = PREVIEW_HEIGHT,
  fallback = null,
}: VisualizationPreviewProps) {
  // Fetch the insight for this visualization
  const { data: insight, isLoading: isLoadingInsight } = useInsight(
    visualization.insightId,
  );

  // Fetch data tables for encoding resolution
  const { data: dataTables = [] } = useDataTables();

  // Find the data table for this insight (React Compiler memoizes this).
  const dataTable = !insight?.baseTableId
    ? undefined
    : dataTables.find((t) => t.id === insight.baseTableId);

  // Build a minimal insight shape for hook consumption (joins only; no
  // selectedFields/metrics/filters — preview renders raw model data).
  const insightForView = useMemo((): Insight | null => {
    if (!insight) return null;
    return {
      id: insight.id,
      name: insight.name,
      baseTableId: insight.baseTableId,
      joins: insight.joins,
    } as Insight;
  }, [insight]);

  // Create/get the DuckDB view using the same hook as insight pages
  // This ensures views are created on-demand and properly cached
  const { viewName, isReady, error } = useInsightView(insight);

  // Resolve instance-qualified fields for repeat-join insights so that
  // field:<uuid>_j1 encodings resolve to their SQL alias correctly.
  const { resolvedFields: instanceAwareFields } = useInsightPagination({
    insight: insightForView ?? ({} as Insight),
    showModelPreview: false,
    enabled: !!insightForView,
  });

  // Resolve encoding from storage format (field:<uuid>, metric:<uuid>) to SQL expressions
  // - field:<uuid> → column name (e.g., "Product")
  // - metric:<uuid> → SQL aggregation (e.g., "sum(Quantity)")
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (!visualization.encoding || !dataTable || !insight) {
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
          : (dataTable.fields ?? []),
      metrics: insight.metrics ?? [],
    };

    // Resolve prefixed IDs to SQL expressions
    const resolved = resolveEncodingToSql(visualization.encoding, context);

    return {
      ...resolved,
      xType: visualization.encoding.xType,
      yType: visualization.encoding.yType,
      // Pass through date transforms for temporal bar charts
      xTransform: visualization.encoding.xTransform,
      yTransform: visualization.encoding.yTransform,
    };
  }, [visualization.encoding, dataTable, insight, instanceAwareFields]);

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
    <div className="h-full w-full overflow-hidden" style={{ height }}>
      <Chart
        tableName={viewName}
        visualizationType={visualization.visualizationType}
        encoding={resolvedEncoding}
        width="container"
        height="container"
        preview
        className="h-full w-full"
      />
    </div>
  );
}
