import { useInsightPagination } from "@/hooks/useInsightPagination";
import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import { validateEncoding } from "@/lib/visualizations/encoding-enforcer";
import { isGeneratedColumnLabel } from "@dashframe/engine";
import type {
  ColumnAnalysis,
  CompiledInsight,
  Field,
  Insight,
  Visualization,
  VisualizationType,
} from "@dashframe/types";
import { useCallback, useMemo } from "react";
import { getVisualizationTypeChange } from "./visualization-type-change";

const NO_DISPLAY_NAMES: Record<string, string> = {};

/**
 * What a saved chart's encoding editor needs from its insight: the model's
 * columns and labels, a sample analysis of the result frame, and the compiled
 * dimensions and metrics an encoding may reference. Shared by the insight
 * workbench and the report item pane so both edit against the same options.
 */
export function useSavedChartEncodingOptions({
  insight,
  enabled,
  baseColumnDisplayNames = NO_DISPLAY_NAMES,
}: {
  insight: Insight;
  enabled: boolean;
  /** Labels to fall back on for columns the model preview has not named. */
  baseColumnDisplayNames?: Record<string, string>;
}) {
  const {
    columns,
    columnDisplayNames: modelColumnDisplayNames,
    resolvedFields,
    error: modelError,
    retry: retryModel,
  } = useInsightPagination({ insight, showModelPreview: true, enabled });
  const {
    columnDisplayNames: renderedColumnDisplayNames,
    schema,
    sampleRows,
    totalCount,
    isReady,
    error: resultError,
    retry: retryResult,
  } = useInsightPagination({ insight, showModelPreview: false, enabled });

  const columnDisplayNames = useMemo(() => {
    const displayNames = {
      ...baseColumnDisplayNames,
      ...modelColumnDisplayNames,
    };
    for (const column of columns) {
      const renderedLabel = renderedColumnDisplayNames[column.name];
      if (renderedLabel && !isGeneratedColumnLabel(renderedLabel)) {
        displayNames[column.name] = renderedLabel;
        continue;
      }
      displayNames[column.name] ??= column.name;
    }
    return displayNames;
  }, [
    baseColumnDisplayNames,
    modelColumnDisplayNames,
    columns,
    renderedColumnDisplayNames,
  ]);

  const columnAnalysis = useMemo<ColumnAnalysis[]>(
    () => (isReady ? analyzeFrameSample(schema, sampleRows, totalCount) : []),
    [isReady, totalCount, sampleRows, schema],
  );

  const availableFields = useMemo(() => {
    const fields = new Map<string, Field>();
    for (const field of resolvedFields) fields.set(field.id, field);
    return [...fields.values()];
  }, [resolvedFields]);

  const compiledInsight = useMemo<CompiledInsight>(() => {
    const fieldsById = new Map(
      availableFields.map((field) => [field.id, field]),
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
  }, [availableFields, insight]);

  const retry = useCallback(() => {
    retryModel();
    retryResult();
  }, [retryModel, retryResult]);

  return {
    columns,
    columnDisplayNames,
    columnAnalysis,
    availableFields,
    compiledInsight,
    isReady,
    error: Boolean(modelError || resultError),
    retry,
  };
}

/**
 * Chart types a saved chart can switch to while its X and Y encodings stay
 * valid. Before the encoding options load, only the current type is offered.
 */
export function savedChartTypeOptions(
  visualization: Pick<Visualization, "visualizationType" | "encoding">,
  chartTypes: readonly VisualizationType[],
  isReady: boolean,
  columnAnalysis: ColumnAnalysis[],
  compiledInsight: CompiledInsight,
): Set<VisualizationType> {
  if (!isReady) return new Set([visualization.visualizationType]);
  return new Set(
    chartTypes.filter((chartType) => {
      if (chartType === visualization.visualizationType) return true;
      const updates = getVisualizationTypeChange(visualization, chartType);
      const encoding = updates?.encoding ?? visualization.encoding ?? {};
      if (!encoding.x || !encoding.y) return false;
      const errors = validateEncoding(
        encoding,
        chartType,
        columnAnalysis,
        compiledInsight,
      );
      return !errors.x && !errors.y;
    }),
  );
}
