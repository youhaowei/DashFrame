import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type {
  ColumnAnalysis,
  DataTable,
  UUID,
  Visualization,
  VisualizationEncoding,
} from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { useCallback, useEffect } from "react";

export type VisualizationEncodingField = "x" | "y" | "color" | "size";

interface UseVisualizationEncodingChangeOptions {
  visualization: Pick<Visualization, "id" | "encoding"> | undefined;
  dataTable: Pick<DataTable, "fields"> | undefined;
  columnAnalysis: ColumnAnalysis[];
  updateVisualization: (args: {
    id: UUID;
    updates: { encoding: VisualizationEncoding };
  }) => Promise<unknown>;
}

function inferAxisType(
  semantic: string,
): "quantitative" | "nominal" | "ordinal" | "temporal" {
  if (semantic === "numerical") return "quantitative";
  if (semantic === "temporal") return "temporal";
  return "nominal";
}

function isAxisField(field: VisualizationEncodingField): field is "x" | "y" {
  return field === "x" || field === "y";
}

/**
 * Keep saved-visualization encoding edits on one write path. Besides persisting
 * the selected channel, this applies the analysis-derived axis type and clears
 * date transforms that no longer match a temporal column.
 */
export function useVisualizationEncodingChange({
  visualization,
  dataTable,
  columnAnalysis,
  updateVisualization,
}: UseVisualizationEncodingChangeOptions) {
  const resolveAnalysisAlias = useCallback(
    (value: string) => {
      const parsed = parseEncoding(value);
      if (parsed?.type === "field") return fieldIdToColumnAlias(parsed.id);
      if (parsed?.type === "metric") return metricIdToColumnAlias(parsed.id);

      const field = dataTable?.fields?.find(
        (candidate) =>
          candidate.name === value || candidate.columnName === value,
      );
      return field ? fieldIdToColumnAlias(field.id) : value;
    },
    [dataTable?.fields],
  );

  useEffect(() => {
    if (!visualization || columnAnalysis.length === 0) return;

    const nextEncoding: VisualizationEncoding = {
      ...visualization.encoding,
    };
    let changed = false;

    const clearInvalidDateTransform = (axis: "x" | "y") => {
      const value = nextEncoding[axis];
      const transformKey = axis === "x" ? "xTransform" : "yTransform";
      if (!value || !nextEncoding[transformKey]) return;

      const semantic = columnAnalysis.find(
        (column) => column.columnName === resolveAnalysisAlias(value),
      )?.semantic;
      if (semantic && semantic !== "temporal") {
        delete nextEncoding[transformKey];
        changed = true;
      }
    };

    clearInvalidDateTransform("x");
    clearInvalidDateTransform("y");

    if (changed) {
      void updateVisualization({
        id: visualization.id,
        updates: { encoding: nextEncoding },
      });
    }
  }, [
    columnAnalysis,
    resolveAnalysisAlias,
    updateVisualization,
    visualization,
  ]);

  return useCallback(
    async (field: VisualizationEncodingField, value: string) => {
      if (!visualization) return;

      const nextEncoding: VisualizationEncoding = {
        ...visualization.encoding,
        [field]: value,
      };

      if (isAxisField(field)) {
        const analysis = columnAnalysis.find(
          (column) => column.columnName === resolveAnalysisAlias(value),
        );
        if (analysis) {
          nextEncoding[field === "x" ? "xType" : "yType"] = inferAxisType(
            analysis.semantic,
          );
          if (analysis.semantic !== "temporal") {
            if (field === "x") delete nextEncoding.xTransform;
            else delete nextEncoding.yTransform;
          }
        }
      }

      await updateVisualization({
        id: visualization.id,
        updates: { encoding: nextEncoding },
      });
    },
    [columnAnalysis, resolveAnalysisAlias, updateVisualization, visualization],
  );
}
