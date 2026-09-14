import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type {
  ColumnAnalysis,
  CompiledInsight,
  DataTable,
  UUID,
  Visualization,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { isColumnValidForChannel } from "@/lib/visualizations/encoding-enforcer";
import { getVisualizationTypeChange } from "./visualization-type-change";

export type VisualizationEncodingField = "x" | "y" | "color" | "size";

type PendingVisualization = {
  id: UUID;
  visualizationType: VisualizationType;
  encoding: VisualizationEncoding | undefined;
};

interface UseVisualizationEncodingChangeOptions {
  visualization:
    | Pick<Visualization, "id" | "encoding" | "visualizationType">
    | undefined;
  dataTable: Pick<DataTable, "fields"> | undefined;
  columnAnalysis: ColumnAnalysis[];
  compiledInsight?: CompiledInsight;
  updateVisualization: (args: {
    id: UUID;
    updates: {
      visualizationType?: VisualizationType;
      encoding?: VisualizationEncoding;
    };
  }) => Promise<unknown>;
  onUpdateError?: () => void;
  /** Reports pending state synchronously so sibling dependency checks can block. */
  onPendingChange?: (pending: boolean) => void;
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
  compiledInsight,
  updateVisualization,
  onUpdateError,
  onPendingChange,
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
  const pendingVisualizationsRef = useRef(
    new Map<UUID, PendingVisualization>(),
  );
  const inFlightWritesRef = useRef(new Map<UUID, number>());
  // The latest write that succeeded but may not have rendered yet. A newer
  // write that fails falls back to this rather than the prop, which can still
  // lack the successful change.
  const succeededVisualizationsRef = useRef(
    new Map<UUID, { sequence: number; state: PendingVisualization }>(),
  );
  const writeSequenceRef = useRef(0);
  const [renderedPendingVisualizations, setRenderedPendingVisualizations] =
    useState(() => new Map<UUID, PendingVisualization>());
  const refreshPendingVisualization = useCallback(() => {
    const pending = new Map(pendingVisualizationsRef.current);
    setRenderedPendingVisualizations(pending);
  }, []);
  useEffect(() => {
    // Convex resolves a mutation only once subscriptions reflect it, so any
    // prop rendered after a success already contains it — and may carry newer
    // changes the stored snapshot would overwrite.
    const visualizationId = visualization?.id;
    if (!visualizationId) return;
    succeededVisualizationsRef.current.delete(visualizationId);
    if (
      (inFlightWritesRef.current.get(visualizationId) ?? 0) === 0 &&
      pendingVisualizationsRef.current.delete(visualizationId)
    ) {
      refreshPendingVisualization();
    }
  }, [
    refreshPendingVisualization,
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
      pendingVisualizationsRef.current.set(next.id, next);
      onPendingChange?.(true);
      refreshPendingVisualization();
      inFlightWritesRef.current.set(
        next.id,
        (inFlightWritesRef.current.get(next.id) ?? 0) + 1,
      );
      const sequence = ++writeSequenceRef.current;
      try {
        await updateVisualization({ id: next.id, updates });
        const succeeded = succeededVisualizationsRef.current.get(next.id);
        if (!succeeded || succeeded.sequence < sequence) {
          succeededVisualizationsRef.current.set(next.id, {
            sequence,
            state: next,
          });
        }
      } catch (error) {
        // Only the newest write owns the pending state; an older failure is
        // already folded into the writes built on top of it.
        if (pendingVisualizationsRef.current.get(next.id) === next) {
          const succeeded = succeededVisualizationsRef.current.get(next.id);
          if (succeeded) {
            pendingVisualizationsRef.current.set(next.id, succeeded.state);
          } else {
            pendingVisualizationsRef.current.delete(next.id);
          }
          refreshPendingVisualization();
        }
        throw error;
      } finally {
        const inFlight = (inFlightWritesRef.current.get(next.id) ?? 1) - 1;
        if (inFlight === 0) inFlightWritesRef.current.delete(next.id);
        else inFlightWritesRef.current.set(next.id, inFlight);
        if (
          [...inFlightWritesRef.current.values()].every((count) => count === 0)
        ) {
          onPendingChange?.(false);
        }
      }
    },
    [onPendingChange, refreshPendingVisualization, updateVisualization],
  );

  useEffect(() => {
    if (!visualization || columnAnalysis.length === 0) return;

    const pending = pendingVisualizationsRef.current.get(visualization.id);
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

      const pending = pendingVisualizationsRef.current.get(visualization.id);
      const visualizationType =
        pending?.id === visualization.id
          ? pending.visualizationType
          : visualization.visualizationType;
      if (
        value &&
        isAxisField(field) &&
        columnAnalysis.length > 0 &&
        compiledInsight &&
        !isColumnValidForChannel(
          value,
          field,
          visualizationType,
          columnAnalysis,
          compiledInsight,
        ).suitable
      ) {
        return;
      }
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
        visualizationType: visualizationType,
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
      compiledInsight,
      commitVisualizationChange,
      resolveAnalysisAlias,
      visualization,
    ],
  );

  const changeType = useCallback(
    async (nextType: VisualizationType) => {
      if (!visualization) return;
      const pending = pendingVisualizationsRef.current.get(visualization.id);
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

  const pendingVisualization = visualization
    ? renderedPendingVisualizations.get(visualization.id)
    : undefined;
  const effectiveVisualization =
    visualization && pendingVisualization
      ? { ...visualization, ...pendingVisualization }
      : visualization;

  return { changeEncoding, changeType, effectiveVisualization };
}
