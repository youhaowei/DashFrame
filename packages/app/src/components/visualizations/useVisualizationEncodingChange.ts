import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type {
  ColumnAnalysis,
  DataTable,
  UUID,
  Visualization,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { useCallback, useEffect, useRef } from "react";
import { getVisualizationTypeChange } from "./visualization-type-change";

export type VisualizationEncodingField = "x" | "y" | "color" | "size";

interface UseVisualizationEncodingChangeOptions {
  visualization:
    | Pick<Visualization, "id" | "encoding" | "visualizationType">
    | undefined;
  dataTable: Pick<DataTable, "fields"> | undefined;
  columnAnalysis: ColumnAnalysis[];
  updateVisualization: (args: {
    id: UUID;
    updates: {
      visualizationType?: VisualizationType;
      encoding?: VisualizationEncoding;
    };
  }) => Promise<unknown>;
  onUpdateError?: () => void;
  /**
   * Rejects a type change that is invalid for the pending visualization, which
   * can differ from the rendered one until a queued write echoes.
   */
  canChangeType?: (
    visualization: Pick<Visualization, "visualizationType" | "encoding">,
    nextType: VisualizationType,
  ) => boolean;
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
 * Set the axis type from the column's analysis and drop a date transform that
 * no longer applies to a non-temporal column.
 */
function applyAxisAnalysis(
  encoding: VisualizationEncoding,
  axis: "x" | "y",
  analysis: ColumnAnalysis | undefined,
): void {
  if (!analysis) return;
  encoding[axis === "x" ? "xType" : "yType"] = inferAxisType(analysis.semantic);
  if (analysis.semantic === "temporal") return;
  if (axis === "x") delete encoding.xTransform;
  else delete encoding.yTransform;
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
  onUpdateError,
  canChangeType,
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

  // Every visualization edit composes against the latest local state until
  // Convex echoes it. This includes bar-orientation changes, which update the
  // type and swap the encoding in one write.
  const pendingVisualizationRef = useRef<{
    id: UUID;
    visualizationType: VisualizationType;
    encoding: VisualizationEncoding | undefined;
  } | null>(null);
  const inFlightWritesRef = useRef(0);
  // The latest write that succeeded but may not have rendered yet. A newer
  // write that fails falls back to this rather than the prop, which can still
  // lack the successful change.
  const succeededVisualizationRef = useRef<{
    sequence: number;
    state: NonNullable<typeof pendingVisualizationRef.current>;
  } | null>(null);
  const writeSequenceRef = useRef(0);
  useEffect(() => {
    // Convex resolves a mutation only once subscriptions reflect it, so any
    // prop rendered after a success already contains it — and may carry newer
    // changes the stored snapshot would overwrite.
    succeededVisualizationRef.current = null;
    if (inFlightWritesRef.current === 0) {
      pendingVisualizationRef.current = null;
    }
  }, [
    visualization?.id,
    visualization?.visualizationType,
    visualization?.encoding,
  ]);

  const commitVisualizationChange = useCallback(
    async (
      next: {
        id: UUID;
        visualizationType: VisualizationType;
        encoding: VisualizationEncoding | undefined;
      },
      updates: {
        visualizationType?: VisualizationType;
        encoding?: VisualizationEncoding;
      },
    ) => {
      pendingVisualizationRef.current = next;
      inFlightWritesRef.current += 1;
      const sequence = ++writeSequenceRef.current;
      try {
        await updateVisualization({ id: next.id, updates });
        const succeeded = succeededVisualizationRef.current;
        if (!succeeded || succeeded.sequence < sequence) {
          succeededVisualizationRef.current = { sequence, state: next };
        }
      } catch (error) {
        // Only the newest write owns the pending state; an older failure is
        // already folded into the writes built on top of it.
        if (pendingVisualizationRef.current === next) {
          const succeeded = succeededVisualizationRef.current;
          pendingVisualizationRef.current =
            succeeded?.state.id === next.id ? succeeded.state : null;
        }
        throw error;
      } finally {
        inFlightWritesRef.current -= 1;
      }
    },
    [updateVisualization],
  );

  useEffect(() => {
    if (!visualization || columnAnalysis.length === 0) return;

    const pending = pendingVisualizationRef.current;
    const baseEncoding =
      pending?.id === visualization.id
        ? pending.encoding
        : visualization.encoding;
    const nextEncoding: VisualizationEncoding = {
      ...baseEncoding,
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
      const next = {
        id: visualization.id,
        visualizationType:
          pending?.id === visualization.id
            ? pending.visualizationType
            : visualization.visualizationType,
        encoding: nextEncoding,
      };
      commitVisualizationChange(next, {
        encoding: nextEncoding,
        ...(next.visualizationType !== visualization.visualizationType
          ? { visualizationType: next.visualizationType }
          : {}),
      }).catch(() => onUpdateError?.());
    }
  }, [
    columnAnalysis,
    commitVisualizationChange,
    onUpdateError,
    resolveAnalysisAlias,
    visualization,
  ]);

  const changeEncoding = useCallback(
    async (field: VisualizationEncodingField, value: string) => {
      if (!visualization) return;

      const pending = pendingVisualizationRef.current;
      const baseEncoding =
        pending?.id === visualization.id
          ? pending.encoding
          : visualization.encoding;
      const nextEncoding: VisualizationEncoding = value
        ? { ...baseEncoding, [field]: value }
        : { ...baseEncoding };
      if (!value) {
        delete nextEncoding[field];
        if (field === "x") {
          delete nextEncoding.xType;
          delete nextEncoding.xTransform;
        } else if (field === "y") {
          delete nextEncoding.yType;
          delete nextEncoding.yTransform;
        }
      }

      if (value && isAxisField(field)) {
        applyAxisAnalysis(
          nextEncoding,
          field,
          columnAnalysis.find(
            (column) => column.columnName === resolveAnalysisAlias(value),
          ),
        );
      }

      const next = {
        id: visualization.id,
        visualizationType:
          pending?.id === visualization.id
            ? pending.visualizationType
            : visualization.visualizationType,
        encoding: nextEncoding,
      };
      await commitVisualizationChange(next, {
        encoding: nextEncoding,
        ...(next.visualizationType !== visualization.visualizationType
          ? { visualizationType: next.visualizationType }
          : {}),
      });
    },
    [
      columnAnalysis,
      commitVisualizationChange,
      resolveAnalysisAlias,
      visualization,
    ],
  );

  const changeType = useCallback(
    async (nextType: VisualizationType) => {
      if (!visualization) return;
      const pending = pendingVisualizationRef.current;
      const current =
        pending?.id === visualization.id
          ? pending
          : {
              id: visualization.id,
              visualizationType: visualization.visualizationType,
              encoding: visualization.encoding,
            };
      if (canChangeType && !canChangeType(current, nextType)) return;
      const updates = getVisualizationTypeChange(current, nextType);
      if (!updates) return;
      const next = {
        ...current,
        visualizationType: updates.visualizationType,
        encoding: updates.encoding ?? current.encoding,
      };
      await commitVisualizationChange(next, {
        ...updates,
        ...(updates.encoding === undefined && pending?.id === visualization.id
          ? { encoding: current.encoding }
          : {}),
      });
    },
    [canChangeType, commitVisualizationChange, visualization],
  );

  return { changeEncoding, changeType };
}
