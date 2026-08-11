import { useBindArtifact } from "@/components/assistant/artifact-context";
import { AppLayout } from "@/components/layouts/AppLayout";
import { useContextPanelSection } from "@/components/shell/context-panel-outlet";
import { AxisSelectField } from "@/components/visualizations/AxisSelectField";
import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { getColumnIcon } from "@/lib/utils/field-icons";
import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import {
  getSwappedChartType,
  isSwapAllowed,
  validateEncoding,
} from "@/lib/visualizations/encoding-enforcer";
import { getAlternativeChartTypes } from "@/lib/visualizations/suggest-charts";
import { api } from "@/wystack/api";
import {
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  getMetricDisplayLabel,
  isGeneratedColumnLabel,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import type {
  ColumnAnalysis,
  ColumnType,
  Field,
  Insight as InsightType,
  UUID,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import {
  buildVisualizationUpdateCommands,
  CHART_TYPE_METADATA,
  parseEncoding,
} from "@dashframe/types";
import { SelectField } from "@dashframe/ui";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@wystack/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Spinner,
} from "@wystack/ui-react";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChartIcon,
  DataPointIcon,
  DeleteIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCompiledInsight } from "../_hooks/useCompiledInsight";

interface VisualizationPageContentProps {
  visualizationId: string;
}

type EncodingField = "x" | "y" | "color" | "size";
type AxisEncodingField = Extract<EncodingField, "x" | "y">;

// Get icon for visualization type
function getVizIcon(type: string) {
  switch (type) {
    case "barY":
    case "barX":
      return <ChartIcon className="h-5 w-5" />;
    case "line":
    case "areaY":
      return <ChartIcon className="h-5 w-5" />;
    case "dot":
    case "hexbin":
    case "heatmap":
    case "raster":
      return <DataPointIcon className="h-5 w-5" />;
    default:
      return <ChartIcon className="h-5 w-5" />;
  }
}

function isAxisEncodingField(field: EncodingField): field is AxisEncodingField {
  return field === "x" || field === "y";
}

function AlternativeChartTypeButtons({
  chartType,
  onSelect,
}: {
  chartType: VisualizationType;
  onSelect: (type: VisualizationType) => void;
}) {
  const alternatives = getAlternativeChartTypes(chartType);
  if (alternatives.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs text-neutral-fg-subtle">Similar charts</p>
      <div className="flex flex-wrap gap-1">
        {alternatives.map((altType) => {
          const meta = CHART_TYPE_METADATA[altType];
          return (
            <Button
              key={altType}
              label={meta.displayName}
              variant="outline"
              size="sm"
              onClick={() => onSelect(altType)}
              className="text-xs"
              tooltip={meta.hint}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Visualization Detail Page
 *
 * Shows a single visualization with:
 * - Chart/table display with view mode toggle
 * - Encoding controls for axis configuration
 * - Link back to source insight if applicable
 * - Delete functionality
 */
export default function VisualizationPageContent({
  visualizationId,
}: VisualizationPageContentProps) {
  const navigate = useNavigate();

  const { data: visualizations = [], isLoading: isVizLoading } = useQuery(
    api.listVisualizations,
    { args: {} },
  );
  const { data: insights = [] } = useQuery(api.listInsights, { args: {} });
  const { data: dataTables = [] } = useQuery(api.listDataTables, { args: {} });
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);
  const updateVisualizationMutation = useCallback(
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
  const { mutateAsync: removeVisualizationMutation } = useMutation(
    api.removeVisualization,
  );
  const { confirm } = useConfirmDialogStore();

  // Find the visualization
  const visualization = useMemo(
    () => visualizations.find((v) => v.id === visualizationId),
    [visualizations, visualizationId],
  );

  // Bind the assistant to this visualization (cleared on unmount).
  useBindArtifact(
    useMemo(
      () =>
        visualization
          ? {
              kind: "visualization" as const,
              id: visualizationId,
              title: visualization.name || "Untitled visualization",
            }
          : null,
      [visualization, visualizationId],
    ),
  );

  // Find the insight (React Compiler memoizes this).
  const insight = visualization?.insightId
    ? insights.find((i) => i.id === visualization.insightId)
    : undefined;

  // Get compiled insight with resolved dimensions (for AxisSelectField)
  const { data: compiledInsight } = useCompiledInsight(
    visualization?.insightId,
  );

  // Find the data table (React Compiler memoizes this).
  const dataTable = insight?.baseTableId
    ? dataTables.find((t) => t.id === insight.baseTableId)
    : undefined;

  // The model-preview mutation validates the complete ephemeral Insight
  // definition. Keep the canonical selected fields and metrics instead of
  // reducing the object to the older browser-view subset.
  const insightForView: InsightType | null = insight ?? null;

  const {
    columns: modelColumns,
    columnDisplayNames: modelColumnDisplayNames,
    resolvedFields: instanceAwareFields,
  } = useInsightPagination({
    insight: insightForView ?? ({} as InsightType),
    showModelPreview: true,
    enabled: !!insightForView,
  });
  const {
    columnDisplayNames: renderedColumnDisplayNames,
    schema: renderedSchema = [],
    sampleRows: renderedRows = [],
    totalCount: renderedRowCount = 0,
    isReady: isRenderedDataReady,
  } = useInsightPagination({
    insight: insightForView ?? ({} as InsightType),
    showModelPreview: false,
    enabled: !!insightForView,
  });
  const dataFrame = useMemo(
    () =>
      isRenderedDataReady
        ? {
            rows: renderedRows,
            columns: renderedSchema.map(({ id, type }) => ({
              name: id,
              type: type as ColumnType,
            })),
          }
        : null,
    [isRenderedDataReady, renderedRows, renderedSchema],
  );

  const axisColumnDisplayNames = useMemo(() => {
    const displayNames = { ...modelColumnDisplayNames };
    // Merge in any better labels from the rendered (query-mode) view via
    // stable-identifier lookup. `modelColumns` and `renderedColumns` come
    // from different pipelines with different counts and orderings; positional
    // pairing would mismatch labels (e.g., a "Date" column receiving the
    // "Sum of Revenue" label). Both display-name maps share the same
    // `field_<uuid>` key space, so the name-based lookup is safe.
    modelColumns.forEach((column) => {
      const renderedLabel = renderedColumnDisplayNames[column.name];
      if (renderedLabel && !isGeneratedColumnLabel(renderedLabel)) {
        displayNames[column.name] = renderedLabel;
        return;
      }
      displayNames[column.name] ??= column.name;
    });
    return displayNames;
  }, [modelColumnDisplayNames, modelColumns, renderedColumnDisplayNames]);

  const axisSourceColumns = useMemo(() => {
    if (modelColumns.length) {
      return modelColumns.map((column) => ({
        name: column.name,
        type: column.type ?? ("unknown" as const),
      }));
    }
    return dataFrame?.columns ?? [];
  }, [dataFrame, modelColumns]);

  const compiledInsightForValidation = useMemo(() => {
    if (!compiledInsight) return undefined;

    const fieldsById = new Map<string, Field>();
    for (const field of dataTable?.fields ?? []) {
      fieldsById.set(field.id, field);
    }
    for (const field of compiledInsight.dimensions) {
      fieldsById.set(field.id, field);
    }

    return {
      ...compiledInsight,
      dimensions: [...fieldsById.values()],
    };
  }, [compiledInsight, dataTable?.fields]);

  // Include the live saved-Insight run to prevent a data-unavailable flash.
  const isLoading = isVizLoading || (visualization && !dataFrame);

  // Local edit buffer for the visualization name. While the user has not
  // typed an override, we render whatever is on the visualization itself.
  const [vizNameOverride, setVizNameOverride] = useState<string | null>(null);
  const prevVizNameRef = useRef(visualization?.name);
  // When the source of truth changes externally, drop the local override.
  useEffect(() => {
    if (prevVizNameRef.current !== visualization?.name) {
      prevVizNameRef.current = visualization?.name;
      setVizNameOverride(null);
    }
  }, [visualization?.name]);
  const vizName = vizNameOverride ?? visualization?.name ?? "";
  const setVizName = (next: string) => setVizNameOverride(next);

  const columnAnalysis = useMemo<ColumnAnalysis[]>(
    () => analyzeFrameSample(renderedSchema, renderedRows, renderedRowCount),
    [renderedRowCount, renderedRows, renderedSchema],
  );

  // Get column options for Color/Size selects (derived from compiledInsight +
  // instance-aware fields for repeat-joins).
  // Uses storage encoding format (field:<uuid>, metric:<uuid>) for values.
  // Includes icons to show column types.
  //
  // `compiledInsight.dimensions` only contains bare-ID fields that were
  // explicitly selected.  Repeat-join instances (field id `<uuid>_j1`) are
  // available in `instanceAwareFields` but absent from `compiledInsight`.
  // We append any such missing instances so Color/Size pickers expose the full
  // set of chartable fields — matching the axis picker's behavior.
  const columnOptions = useMemo(() => {
    if (!compiledInsight) return [];

    // Build set of metric SQL aliases for icon lookup
    const metricAliases = new Set(
      compiledInsight.metrics.map((m) => metricIdToColumnAlias(m.id)),
    );
    const options: Array<{
      label: string;
      value: string;
      icon: React.ComponentType<{ className?: string }>;
    }> = [];

    // Track which field encodings we have already added to avoid duplicates.
    const addedEncodings = new Set<string>();

    // Add dimensions (resolved Field objects from compiledInsight).
    // Use disambiguated display names from axisColumnDisplayNames when available
    // (they carry "(leftKey)" suffixes for repeat-join collisions).
    compiledInsight.dimensions.forEach((field) => {
      const sqlAlias = fieldIdToColumnAlias(field.id);
      const enc = `field:${field.id}`;
      const label = axisColumnDisplayNames[sqlAlias] ?? field.name;
      options.push({
        label,
        value: enc,
        icon: getColumnIcon(sqlAlias, columnAnalysis, metricAliases),
      });
      addedEncodings.add(enc);
    });

    // Append any repeat-join instance fields from instanceAwareFields that are
    // not already covered by compiledInsight.dimensions.  A field is a repeat-
    // join instance when extractColumnAliasComponents returns instanceIndex > 0.
    for (const field of instanceAwareFields) {
      const enc = `field:${field.id}`;
      if (addedEncodings.has(enc)) continue;
      const components = extractColumnAliasComponents(
        fieldIdToColumnAlias(field.id),
      );
      if (!components || components.instanceIndex === 0) continue; // only j1+
      const sqlAlias = fieldIdToColumnAlias(field.id);
      const label = axisColumnDisplayNames[sqlAlias] ?? field.name;
      options.push({
        label,
        value: enc,
        icon: getColumnIcon(sqlAlias, columnAnalysis, metricAliases),
      });
      addedEncodings.add(enc);
    }

    // Add metrics using metric:<uuid> encoding format
    compiledInsight.metrics.forEach((metric) => {
      const sqlAlias = metricIdToColumnAlias(metric.id);
      options.push({
        label: getMetricDisplayLabel(metric, dataTable?.fields),
        value: `metric:${metric.id}`,
        icon: getColumnIcon(sqlAlias, columnAnalysis, metricAliases),
      });
    });

    return options;
  }, [
    compiledInsight,
    columnAnalysis,
    dataTable?.fields,
    instanceAwareFields,
    axisColumnDisplayNames,
  ]);

  // Validate encoding configuration - returns errors for X/Y if invalid
  const encodingErrors = useMemo(() => {
    if (!visualization || columnAnalysis.length === 0) return {};
    return validateEncoding(
      visualization.encoding ?? {},
      visualization.visualizationType,
      columnAnalysis,
      compiledInsightForValidation,
    );
  }, [visualization, columnAnalysis, compiledInsightForValidation]);

  // Check if there are any encoding errors
  const hasEncodingErrors = !!(encodingErrors.x || encodingErrors.y);

  // Handle name change
  const handleNameChange = async (newName: string) => {
    setVizName(newName);
    await updateVisualizationMutation({
      id: visualizationId as UUID,
      updates: { name: newName },
    });
  };

  // Infer axis type from column analysis semantic type
  const inferAxisType = (
    semantic: string,
  ): "quantitative" | "nominal" | "ordinal" | "temporal" => {
    if (semantic === "numerical") return "quantitative";
    if (semantic === "temporal") return "temporal";
    return "nominal";
  };

  const resolveEncodingAnalysisAlias = useCallback(
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

      const analysisAlias = resolveEncodingAnalysisAlias(value);
      const semantic = columnAnalysis.find(
        (column) => column.columnName === analysisAlias,
      )?.semantic;
      if (semantic && semantic !== "temporal") {
        delete nextEncoding[transformKey];
        changed = true;
      }
    };

    clearInvalidDateTransform("x");
    clearInvalidDateTransform("y");

    if (changed) {
      void updateVisualizationMutation({
        id: visualizationId as UUID,
        updates: { encoding: nextEncoding },
      });
    }
  }, [
    columnAnalysis,
    resolveEncodingAnalysisAlias,
    updateVisualizationMutation,
    visualization,
    visualizationId,
  ]);

  const applyAxisAnalysisToEncoding = useCallback(
    (
      newEncoding: VisualizationEncoding,
      field: EncodingField,
      value: string,
    ) => {
      if (!isAxisEncodingField(field)) return;

      const sqlAlias = resolveEncodingAnalysisAlias(value);
      const colAnalysis = sqlAlias
        ? columnAnalysis.find((column) => column.columnName === sqlAlias)
        : undefined;
      if (!colAnalysis) return;

      const typeField = field === "x" ? "xType" : "yType";
      newEncoding[typeField] = inferAxisType(colAnalysis.semantic);
      if (colAnalysis.semantic === "temporal") return;

      if (field === "x") {
        delete newEncoding.xTransform;
      } else {
        delete newEncoding.yTransform;
      }
    },
    [columnAnalysis, resolveEncodingAnalysisAlias],
  );

  // Handle encoding change
  // Value comes in as storage encoding format (field:<uuid>, metric:<uuid>)
  const handleEncodingChange = useCallback(
    async (field: EncodingField, value: string) => {
      if (!visualization) return;

      const newEncoding: VisualizationEncoding = {
        ...visualization.encoding,
        [field]: value,
      };

      applyAxisAnalysisToEncoding(newEncoding, field, value);

      await updateVisualizationMutation({
        id: visualizationId as UUID,
        updates: { encoding: newEncoding },
      });
    },
    [
      applyAxisAnalysisToEncoding,
      updateVisualizationMutation,
      visualization,
      visualizationId,
    ],
  );

  // Handle visualization type change
  // Auto-swaps axes when switching between barY and barX
  const handleTypeChange = useCallback(
    async (type: string) => {
      const newType = type as VisualizationType;
      const currentType = visualization?.visualizationType;

      // Check if switching between bar orientations - auto-swap axes
      const isBarSwitch =
        (currentType === "barY" && newType === "barX") ||
        (currentType === "barX" && newType === "barY");

      if (isBarSwitch && visualization?.encoding) {
        // Swap X and Y when changing bar orientation
        const currentEncoding = visualization.encoding;
        const newEncoding = {
          ...currentEncoding,
          x: currentEncoding.y,
          y: currentEncoding.x,
          xType: currentEncoding.yType,
          yType: currentEncoding.xType,
        };

        // Update both type and encoding in a single mutation so a mid-swap
        // failure can't leave the chart with a swapped type but un-swapped
        // axes (a visibly broken mapping). Mirrors handleSwapAxes below.
        await updateVisualizationMutation({
          id: visualizationId as UUID,
          updates: { visualizationType: newType, encoding: newEncoding },
        });
      } else {
        // Just update the type
        await updateVisualizationMutation({
          id: visualizationId as UUID,
          updates: { visualizationType: newType },
        });
      }
    },
    [updateVisualizationMutation, visualization, visualizationId],
  );

  const hasNumericColumns = dataFrame?.columns?.some(
    (col) => col.type === "number",
  );
  const vizTypeOptions = useMemo(
    () =>
      hasNumericColumns
        ? [
            { label: "Bar", value: "barY" },
            { label: "Line", value: "line" },
            { label: "Scatter", value: "dot" },
            { label: "Area", value: "areaY" },
          ]
        : [],
    [hasNumericColumns],
  );

  const isScatterType = ["dot", "hexbin", "heatmap", "raster"].includes(
    visualization?.visualizationType ?? "",
  );
  const rowCount = renderedRowCount;
  const isLargeDataset = rowCount > 10000;
  const scatterRenderModeOptions = useMemo(
    () => [
      {
        label: "Dots",
        value: "dot",
        description: isLargeDataset
          ? `Disabled for large datasets (${rowCount.toLocaleString()} rows)`
          : "Raw dots - best for small datasets",
        disabled: isLargeDataset,
      },
      {
        label: "Hexbin",
        value: "hexbin",
        description: "Hexagonal binning - shows density patterns",
      },
      {
        label: "Heatmap",
        value: "heatmap",
        description: "Smooth density visualization",
      },
      {
        label: "Raster",
        value: "raster",
        description: "Pixel aggregation - fastest for huge datasets",
      },
    ],
    [isLargeDataset, rowCount],
  );
  const displayChartType = isScatterType
    ? "dot"
    : (visualization?.visualizationType ?? "barY");

  const handleDisplayTypeChange = useCallback(
    async (type: string) => {
      if (type === "dot" && !isScatterType) {
        const newType = isLargeDataset ? "hexbin" : "dot";
        await handleTypeChange(newType);
      } else if (type !== "dot") {
        await handleTypeChange(type);
      }
    },
    [handleTypeChange, isLargeDataset, isScatterType],
  );

  const handleSwapAxes = useCallback(async () => {
    if (!visualization) return;

    const currentEncoding = visualization.encoding || {};
    const newEncoding = {
      ...currentEncoding,
      x: currentEncoding.y,
      y: currentEncoding.x,
      xType: currentEncoding.yType,
      yType: currentEncoding.xType,
    };

    const newChartType = getSwappedChartType(visualization.visualizationType);

    if (newChartType !== visualization.visualizationType) {
      await updateVisualizationMutation({
        id: visualizationId as UUID,
        updates: {
          visualizationType: newChartType,
          encoding: newEncoding,
        },
      });
    } else {
      await updateVisualizationMutation({
        id: visualizationId as UUID,
        updates: { encoding: newEncoding },
      });
    }
  }, [updateVisualizationMutation, visualization, visualizationId]);

  const canSwap = visualization
    ? isSwapAllowed(visualization.visualizationType)
    : false;

  // Handle delete
  const handleDelete = () => {
    if (!visualization) return;
    confirm({
      title: "Delete visualization",
      description: `Are you sure you want to delete "${visualization.name}"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await removeVisualizationMutation({ id: visualizationId as UUID });
          navigate({ to: "/insights" });
        } catch {
          toast.error("Couldn't delete the visualization");
        }
      },
    });
  };

  const contextPanelContent = useMemo(() => {
    if (!visualization || !dataFrame) return null;

    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {compiledInsight && (
            <AxisSelectField
              label="X Axis"
              value={visualization.encoding?.x || ""}
              onChange={(value) => handleEncodingChange("x", value)}
              placeholder="Select column..."
              axis="x"
              chartType={visualization.visualizationType}
              columnAnalysis={columnAnalysis}
              compiledInsight={compiledInsight}
              availableFields={
                instanceAwareFields.length > 0
                  ? instanceAwareFields
                  : dataTable?.fields
              }
              availableColumns={axisSourceColumns}
              columnDisplayNames={axisColumnDisplayNames}
              otherAxisColumn={visualization.encoding?.y}
              onSwapAxes={canSwap ? handleSwapAxes : undefined}
            />
          )}

          {canSwap && (
            <div className="flex justify-center">
              <Button
                label="Swap"
                variant="ghost"
                size="sm"
                onClick={handleSwapAxes}
                className="text-neutral-fg-subtle hover:text-neutral-fg"
                tooltip="Swap X and Y axes"
                icon={ArrowUpDownIcon}
              />
            </div>
          )}

          {compiledInsight && (
            <AxisSelectField
              label="Y Axis"
              value={visualization.encoding?.y || ""}
              onChange={(value) => handleEncodingChange("y", value)}
              placeholder="Select column..."
              axis="y"
              chartType={visualization.visualizationType}
              columnAnalysis={columnAnalysis}
              compiledInsight={compiledInsight}
              availableFields={
                instanceAwareFields.length > 0
                  ? instanceAwareFields
                  : dataTable?.fields
              }
              availableColumns={axisSourceColumns}
              columnDisplayNames={axisColumnDisplayNames}
              otherAxisColumn={visualization.encoding?.x}
              onSwapAxes={canSwap ? handleSwapAxes : undefined}
            />
          )}

          <SelectField
            label="Color (optional)"
            value={visualization.encoding?.color || ""}
            onChange={(value) => handleEncodingChange("color", value)}
            onClear={() => handleEncodingChange("color", "")}
            options={columnOptions}
            placeholder="None"
          />

          {visualization.visualizationType === "dot" && (
            <SelectField
              label="Size (optional)"
              value={visualization.encoding?.size || ""}
              onChange={(value) => handleEncodingChange("size", value)}
              onClear={() => handleEncodingChange("size", "")}
              options={columnOptions}
              placeholder="None"
            />
          )}
        </div>

        <div className="border-t border-neutral-border/60 pt-4">
          <h3 className="mb-3 text-sm font-semibold">Chart Type</h3>
          <SelectField
            label=""
            value={displayChartType}
            onChange={handleDisplayTypeChange}
            options={vizTypeOptions}
          />

          {isScatterType && (
            <div className="mt-3">
              <SelectField
                label="Render mode"
                value={visualization.visualizationType}
                onChange={handleTypeChange}
                options={scatterRenderModeOptions}
              />
            </div>
          )}

          <AlternativeChartTypeButtons
            chartType={visualization.visualizationType}
            onSelect={handleTypeChange}
          />
        </div>

        {visualization.insightId && (
          <div className="border-t border-neutral-border/60 pt-4">
            <h3 className="mb-2 text-sm font-semibold">Source</h3>
            <Card
              className="cursor-pointer transition-colors hover:bg-neutral-bg-muted/50"
              onClick={() =>
                navigate({
                  to: `/insights/${visualization.insightId}`,
                } as never)
              }
            >
              <CardContent className="p-3">
                <p className="truncate text-sm font-medium">Source Insight</p>
                <p className="text-xs text-neutral-fg-subtle">
                  Click to view insight details
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }, [
    axisColumnDisplayNames,
    axisSourceColumns,
    canSwap,
    columnAnalysis,
    columnOptions,
    compiledInsight,
    dataFrame,
    dataTable?.fields,
    displayChartType,
    handleDisplayTypeChange,
    handleEncodingChange,
    handleSwapAxes,
    handleTypeChange,
    instanceAwareFields,
    isScatterType,
    navigate,
    scatterRenderModeOptions,
    visualization,
    vizTypeOptions,
  ]);

  const contextPanelSection = useMemo(
    () =>
      contextPanelContent
        ? {
            id: "visualization-encodings",
            title: "Encodings",
            content: contextPanelContent,
          }
        : null,
    [contextPanelContent],
  );
  useContextPanelSection(contextPanelSection);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" className="text-neutral-fg-subtle" />
          <p className="text-sm text-neutral-fg-subtle">
            Loading visualization...
          </p>
        </div>
      </div>
    );
  }

  // Not found state
  if (!visualization) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Visualization not found</h2>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            The visualization you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button
            label="Go to Insights"
            onClick={() => navigate({ to: "/insights" })}
            className="mt-4"
          />
        </div>
      </div>
    );
  }

  // No DataFrame state
  if (!dataFrame) {
    return (
      <AppLayout
        headerContent={
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                label="Back"
                variant="ghost"
                size="sm"
                onClick={() => window.history.back()}
                icon={ArrowLeftIcon}
              />
              <h1 className="text-lg font-semibold">{visualization.name}</h1>
            </div>
          </div>
        }
      >
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="max-w-md">
            <CardContent className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-palette-warning/15">
                {getVizIcon(visualization.visualizationType)}
              </div>
              <h3 className="mb-2 text-lg font-semibold">Data not available</h3>
              <p className="mb-4 text-sm text-neutral-fg-subtle">
                The data for this visualization is not available. Please refresh
                from the source insight.
              </p>
              {visualization.insightId && (
                <Button
                  label="Go to Source Insight"
                  onClick={() =>
                    navigate({
                      to: `/insights/${visualization.insightId}`,
                    } as never)
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      headerContent={
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              label="Back"
              variant="ghost"
              size="sm"
              onClick={() => window.history.back()}
              icon={ArrowLeftIcon}
            />
            <div className="min-w-[220px] flex-1">
              <Input
                value={vizName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Visualization name"
                className="w-full"
              />
            </div>
            <Badge variant="soft">{visualization.visualizationType}</Badge>
          </div>

          {/* Metadata row */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-fg-subtle">
            <span>
              {renderedRowCount.toLocaleString()} rows • {renderedSchema.length}{" "}
              columns
            </span>
            {visualization.insightId && (
              <>
                <span>•</span>
                <button
                  onClick={() =>
                    navigate({
                      to: `/insights/${visualization.insightId}`,
                    } as never)
                  }
                  className="text-palette-primary hover:underline"
                >
                  From insight
                </button>
              </>
            )}
          </div>

          {/* Delete button */}
          <div className="mt-3 flex items-center justify-end">
            <Button
              label="Delete"
              variant="ghost"
              size="sm"
              color="danger"
              onClick={handleDelete}
              icon={DeleteIcon}
            />
          </div>
        </div>
      }
    >
      <div className="h-full overflow-hidden">
        {hasEncodingErrors ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-palette-danger/30 bg-palette-danger/5 p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-palette-danger/15">
                <AlertCircleIcon className="h-6 w-6 text-palette-danger" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-palette-danger">
                Invalid encoding configuration
              </h3>
              <div className="space-y-2 text-sm text-palette-danger/80">
                {encodingErrors.x && (
                  <p>
                    <strong>X Axis:</strong> {encodingErrors.x}
                  </p>
                )}
                {encodingErrors.y && (
                  <p>
                    <strong>Y Axis:</strong> {encodingErrors.y}
                  </p>
                )}
              </div>
              <p className="mt-4 text-xs text-palette-danger/80">
                Please update the axis configuration in the panel on the right.
              </p>
            </div>
          </div>
        ) : (
          <VisualizationDisplay visualizationId={visualizationId} />
        )}
      </div>
    </AppLayout>
  );
}
