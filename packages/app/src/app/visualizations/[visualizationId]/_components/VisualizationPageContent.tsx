import { useBindArtifact } from "@/components/assistant/artifact-context";
import { AppLayout } from "@/components/layouts/AppLayout";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { AxisSelectField } from "@/components/visualizations/AxisSelectField";
import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import {
  computeInsightPreview,
  type PreviewResult,
} from "@/lib/insights/compute-preview";
import { getColumnIcon } from "@/lib/utils/field-icons";
import {
  getSwappedChartType,
  isSwapAllowed,
  validateEncoding,
} from "@/lib/visualizations/encoding-enforcer";
import { getAlternativeChartTypes } from "@/lib/visualizations/suggest-charts";
import {
  getDataFrame as getDexieDataFrame,
  useCompiledInsight,
  useDataTables,
  useInsights,
  useVisualizationMutations,
  useVisualizations,
} from "@dashframe/core";
import {
  fieldIdToColumnAlias,
  getMetricDisplayLabel,
  isGeneratedColumnLabel,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import { analyzeView, type ColumnAnalysis } from "@dashframe/engine-browser";
import type {
  DataFrameColumn,
  DataFrameRow,
  Field,
  Insight as InsightType,
  UUID,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { CHART_TYPE_METADATA, parseEncoding } from "@dashframe/types";
import { SelectField } from "@dashframe/ui";
import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, Card, CardContent, Input, Spinner } from "@wystack/ui";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChartIcon,
  DataPointIcon,
  DeleteIcon,
} from "@wystack/ui-icons";
import { useCallback, useEffect, useMemo, useState } from "react";

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

  // Dexie hooks for data
  const { data: visualizations = [], isLoading: isVizLoading } =
    useVisualizations();
  const { data: insights = [] } = useInsights();
  const { data: dataTables = [] } = useDataTables();
  const {
    update: updateVisualization,
    updateEncoding,
    remove: removeVisualization,
  } = useVisualizationMutations();

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

  // Get the dataFrameId from the dataTable
  const dataFrameId = dataTable?.dataFrameId;

  // Load source DataFrame data async
  const {
    data: sourceDataFrame,
    isLoading: isDataLoading,
    entry: dataFrameEntry,
  } = useDataFrameData(dataFrameId);

  // DuckDB connection for join computation (initialized by DuckDBProvider during idle time)
  const {
    connection: duckDBConnection,
    isInitialized: isDuckDBReady,
    isLoading: isDuckDBLoading,
  } = useDuckDB();

  // Build Insight object for useInsightView (needs baseTableId and joins)
  const insightForView: InsightType | null = useMemo(() => {
    if (!insight) return null;
    return {
      id: insight.id,
      name: insight.name,
      baseTableId: insight.baseTableId,
      joins: insight.joins,
    } as InsightType;
  }, [insight]);

  // Get DuckDB view name for analysis (uses UUID-based column names)
  const { viewName: analysisViewName, isReady: isAnalysisViewReady } =
    useInsightView(insightForView);
  const { columns: modelColumns, columnDisplayNames: modelColumnDisplayNames } =
    useInsightPagination({
      insight: insightForView ?? ({} as InsightType),
      showModelPreview: true,
      enabled: !!insightForView,
    });
  const { columnDisplayNames: renderedColumnDisplayNames } =
    useInsightPagination({
      insight: insightForView ?? ({} as InsightType),
      showModelPreview: false,
      enabled: !!insightForView,
    });

  // State for DuckDB-computed joined data (when insight has joins)
  const [joinedData, setJoinedData] = useState<{
    rows: DataFrameRow[];
    columns: DataFrameColumn[];
  } | null>(null);
  const [isLoadingJoinedData, setIsLoadingJoinedData] = useState(false);

  const hasJoins = Boolean(insight?.joins?.length);

  // Compute joined data using DuckDB when insight has joins
  useEffect(() => {
    // Skip if no joins configured. The publicly-used `joinedData` is gated on
    // `hasJoins` below, so we don't need to clear state here.
    if (!hasJoins) {
      return;
    }

    // Wait for DuckDB to be ready
    if (isDuckDBLoading || !duckDBConnection || !isDuckDBReady) {
      return;
    }

    // Need base dataTable for field info
    if (!dataTable?.dataFrameId) {
      return;
    }

    const computeJoinedData = async () => {
      setIsLoadingJoinedData(true);

      try {
        // Get the base DataFrame
        const baseDataFrame = await getDexieDataFrame(dataTable.dataFrameId!);
        if (!baseDataFrame) {
          throw new Error("Base DataFrame not found");
        }

        // Load base table into DuckDB
        const baseQueryBuilder = await baseDataFrame.load(duckDBConnection);
        await baseQueryBuilder.sql(); // Triggers table creation

        // Load join tables into DuckDB
        for (const join of insight?.joins ?? []) {
          const joinTable = dataTables.find((t) => t.id === join.rightTableId);
          if (joinTable?.dataFrameId) {
            const joinDataFrame = await getDexieDataFrame(
              joinTable.dataFrameId,
            );
            if (joinDataFrame) {
              const joinQueryBuilder =
                await joinDataFrame.load(duckDBConnection);
              await joinQueryBuilder.sql(); // Triggers table creation
            }
          }
        }

        // Build and execute join SQL
        // [Future] Generate proper SQL from insight joins configuration
        // For now, just use the base table data
        const sql = await baseQueryBuilder.sql();
        const result = await duckDBConnection.query(sql);
        const rows = result.toArray() as DataFrameRow[];

        // Build columns from result
        const columns: DataFrameColumn[] =
          rows.length > 0
            ? Object.keys(rows[0]!)
                .filter((key) => !key.startsWith("_"))
                .map((name) => ({
                  name,
                  type:
                    typeof rows[0]![name] === "number"
                      ? ("number" as const)
                      : ("string" as const),
                }))
            : [];

        setJoinedData({ rows, columns });
      } catch (err) {
        console.error(
          "[VisualizationPage] Failed to compute joined data:",
          err,
        );
        setJoinedData(null);
      } finally {
        setIsLoadingJoinedData(false);
      }
    };

    computeJoinedData();
  }, [
    hasJoins,
    insight?.joins,
    insight?.id,
    duckDBConnection,
    isDuckDBReady,
    isDuckDBLoading,
    dataTable,
    dataTables,
  ]);

  // Compute aggregated data if we have an insight with metrics/dimensions (non-join case)
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    // If we have joins, use joinedData instead
    if (insight?.joins?.length) return null;

    if (!sourceDataFrame || !insight || !dataTable) return null;

    // Check if insight has dimensions or metrics configured
    const selectedFields = insight.selectedFields ?? [];
    const metrics = insight.metrics ?? [];

    // If no aggregation config, return null (use raw data)
    if (selectedFields.length === 0 && metrics.length === 0) return null;

    // Use source data directly (DataFrameData format)
    const sourceDataFrameData = {
      columns: sourceDataFrame.columns,
      rows: sourceDataFrame.rows,
    };

    // Build insight object for computation
    const insightForCompute = {
      id: insight.id,
      name: insight.name,
      baseTableId: insight.baseTableId,
      selectedFields: selectedFields,
      metrics: metrics,
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt,
    };

    return computeInsightPreview(
      insightForCompute,
      dataTable,
      sourceDataFrameData,
      1000, // Allow more rows for visualization
    );
  }, [sourceDataFrame, insight, dataTable]);

  // Use joined data if available, then aggregated data, then source data
  const dataFrame = useMemo(() => {
    // Priority 1: DuckDB-computed joined data (when insight has joins)
    if (hasJoins && joinedData) {
      return joinedData;
    }
    // Priority 2: Aggregated preview (non-join case with metrics/dimensions)
    if (aggregatedPreview) {
      return {
        rows: aggregatedPreview.dataFrame.rows,
        columns: aggregatedPreview.dataFrame.columns ?? [],
      };
    }
    // Priority 3: Raw source data
    return sourceDataFrame;
  }, [hasJoins, joinedData, aggregatedPreview, sourceDataFrame]);

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
    if (hasJoins && joinedData) return joinedData.columns;
    if (sourceDataFrame?.columns?.length) return sourceDataFrame.columns;
    const sourceRow = sourceDataFrame?.rows[0];
    if (sourceRow) {
      return Object.keys(sourceRow)
        .filter((name) => !name.startsWith("_"))
        .map((name) => ({ name, type: "unknown" as const }));
    }
    if (dataTable?.sourceSchema?.columns?.length) {
      return dataTable.sourceSchema.columns.map((column) => ({
        name: column.name,
        type: "unknown" as const,
      }));
    }
    if (modelColumns.length) {
      return modelColumns.map((column) => ({
        name: axisColumnDisplayNames[column.name] ?? column.name,
        type: "unknown" as const,
      }));
    }
    return dataFrame?.columns ?? [];
  }, [
    dataFrame,
    dataTable,
    hasJoins,
    joinedData,
    axisColumnDisplayNames,
    modelColumns,
    sourceDataFrame,
  ]);

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

  // Include dataFrame check to prevent "Data not available" flash
  const isLoading =
    isVizLoading ||
    isDataLoading ||
    isLoadingJoinedData ||
    (visualization && !dataFrame);

  // Local edit buffer for the visualization name. While the user has not
  // typed an override, we render whatever is on the visualization itself.
  const [vizNameOverride, setVizNameOverride] = useState<string | null>(null);
  const [lastSyncedName, setLastSyncedName] = useState<string | undefined>(
    visualization?.name,
  );
  if (lastSyncedName !== visualization?.name) {
    setLastSyncedName(visualization?.name);
    // The source of truth changed under us — drop the override.
    setVizNameOverride(null);
  }
  const vizName = vizNameOverride ?? visualization?.name ?? "";
  const setVizName = (next: string) => setVizNameOverride(next);

  // Holds the last successfully analyzed view + result so the "is this still
  // valid for the current view?" check is just a string comparison during
  // render. Returning [] when the analyzed view doesn't match avoids having
  // to synchronously reset state inside the analysis effect.
  const [analysisResult, setAnalysisResult] = useState<{
    viewName: string;
    columns: ColumnAnalysis[];
  } | null>(null);
  const columnAnalysis = useMemo<ColumnAnalysis[]>(
    () =>
      analysisViewName &&
      isAnalysisViewReady &&
      analysisResult?.viewName === analysisViewName
        ? analysisResult.columns
        : [],
    [analysisResult, analysisViewName, isAnalysisViewReady],
  );

  // Run DuckDB analysis on the insight view (has UUID-based column names)
  // DuckDB is lazy-loaded, so we check isDuckDBLoading before running analysis
  useEffect(() => {
    if (isDuckDBLoading || !duckDBConnection || !isDuckDBReady) return;
    if (!analysisViewName || !isAnalysisViewReady) return;

    const targetView = analysisViewName;
    const runAnalysis = async () => {
      try {
        const results = await analyzeView(duckDBConnection, targetView);
        setAnalysisResult({ viewName: targetView, columns: results });
      } catch (e) {
        console.error("[VisualizationPage] Analysis failed:", e);
        setAnalysisResult({ viewName: targetView, columns: [] });
      }
    };
    runAnalysis();
  }, [
    duckDBConnection,
    isDuckDBReady,
    isDuckDBLoading,
    analysisViewName,
    isAnalysisViewReady,
  ]);

  // Get column options for Color/Size selects (derived from compiledInsight)
  // Uses storage encoding format (field:<uuid>, metric:<uuid>) for values
  // Includes icons to show column types
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

    // Add dimensions (resolved Field objects from compiledInsight)
    // Use field:<uuid> encoding format for value
    compiledInsight.dimensions.forEach((field) => {
      const sqlAlias = fieldIdToColumnAlias(field.id);
      options.push({
        label: field.name,
        value: `field:${field.id}`,
        icon: getColumnIcon(sqlAlias, columnAnalysis, metricAliases),
      });
    });

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
  }, [compiledInsight, columnAnalysis, dataTable?.fields]);

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
    await updateVisualization(visualizationId as UUID, { name: newName });
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
      void updateEncoding(visualizationId as UUID, nextEncoding);
    }
  }, [
    columnAnalysis,
    resolveEncodingAnalysisAlias,
    updateEncoding,
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
  const handleEncodingChange = async (field: EncodingField, value: string) => {
    if (!visualization) return;

    const newEncoding: VisualizationEncoding = {
      ...visualization.encoding,
      [field]: value,
    };

    applyAxisAnalysisToEncoding(newEncoding, field, value);

    await updateEncoding(visualizationId as UUID, newEncoding);
  };

  // Handle visualization type change
  // Auto-swaps axes when switching between barY and barX
  const handleTypeChange = async (type: string) => {
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

      // Update both type and encoding together
      await updateVisualization(visualizationId as UUID, {
        visualizationType: newType,
      });
      await updateEncoding(visualizationId as UUID, newEncoding);
    } else {
      // Just update the type
      await updateVisualization(visualizationId as UUID, {
        visualizationType: newType,
      });
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete "${visualization?.name}"?`)) {
      await removeVisualization(visualizationId as UUID);
      navigate({ to: "/insights" });
    }
  };

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
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
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

  // Visualization type options - condensed (bar orientations combined, scatter as umbrella)
  const hasNumericColumns = dataFrame?.columns?.some(
    (col) => col.type === "number",
  );
  const vizTypeOptions = hasNumericColumns
    ? [
        { label: "Bar", value: "barY" },
        { label: "Line", value: "line" },
        { label: "Scatter", value: "dot" },
        { label: "Area", value: "areaY" },
      ]
    : [];

  // Check if current chart is a scatter-type (dot, hexbin, heatmap, raster)
  const isScatterType = ["dot", "hexbin", "heatmap", "raster"].includes(
    visualization?.visualizationType ?? "",
  );

  // Scatter render mode options - disable Dots for large datasets
  const rowCount = dataFrameEntry?.rowCount ?? 0;
  const isLargeDataset = rowCount > 10000;
  const scatterRenderModeOptions = [
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
  ];

  // Get the display chart type (maps scatter variants back to "dot" for UI)
  const displayChartType = isScatterType
    ? "dot"
    : (visualization?.visualizationType ?? "barY");

  // Handle chart type change with scatter umbrella logic
  const handleDisplayTypeChange = async (type: string) => {
    if (type === "dot" && !isScatterType) {
      // Switching to scatter - default to appropriate render mode based on data size
      const newType = isLargeDataset ? "hexbin" : "dot";
      await handleTypeChange(newType);
    } else if (type !== "dot") {
      await handleTypeChange(type);
    }
    // If already scatter-type and selecting dot, keep current render mode
  };

  // Handle swap button click - swaps X/Y axes and toggles bar orientation
  const handleSwapAxes = async () => {
    if (!visualization) return;

    const currentEncoding = visualization.encoding || {};
    const newEncoding = {
      ...currentEncoding,
      x: currentEncoding.y,
      y: currentEncoding.x,
      xType: currentEncoding.yType,
      yType: currentEncoding.xType,
    };

    // For bar charts, also toggle the chart type
    const newChartType = getSwappedChartType(visualization.visualizationType);

    if (newChartType !== visualization.visualizationType) {
      // Update both encoding and chart type
      await updateVisualization(visualizationId as UUID, {
        visualizationType: newChartType,
        encoding: newEncoding,
      });
    } else {
      // Just update encoding
      await updateEncoding(visualizationId as UUID, newEncoding);
    }
  };

  // Check if swap is allowed for current chart type
  const canSwap = isSwapAllowed(visualization.visualizationType);

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
              {dataFrameEntry?.rowCount?.toLocaleString() ?? "?"} rows •{" "}
              {dataFrameEntry?.columnCount ?? "?"} columns
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
      rightPanel={
        <div className="space-y-4 p-4">
          <div>
            <h3 className="mb-3 text-sm font-semibold">Encodings</h3>

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
                  availableFields={dataTable?.fields}
                  availableColumns={axisSourceColumns}
                  columnDisplayNames={axisColumnDisplayNames}
                  otherAxisColumn={visualization.encoding?.y}
                  onSwapAxes={canSwap ? handleSwapAxes : undefined}
                />
              )}

              {/* Swap button - swaps axes and toggles bar orientation */}
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
                  availableFields={dataTable?.fields}
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
          </div>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-semibold">Chart Type</h3>
            <SelectField
              label=""
              value={displayChartType}
              onChange={handleDisplayTypeChange}
              options={vizTypeOptions}
            />

            {/* Render mode selector for scatter-type charts */}
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

            {/* Alternative chart types - show related charts from same tags */}
            {(() => {
              const alternatives = getAlternativeChartTypes(
                visualization.visualizationType,
              );
              if (alternatives.length === 0) return null;

              return (
                <div className="mt-3">
                  <p className="mb-2 text-xs text-neutral-fg-subtle">
                    Similar charts
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {alternatives.map((altType) => {
                      const meta = CHART_TYPE_METADATA[altType];
                      return (
                        <Button
                          key={altType}
                          label={meta.displayName}
                          variant="outline"
                          size="sm"
                          onClick={() => handleTypeChange(altType)}
                          className="text-xs"
                          tooltip={meta.hint}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Source insight link */}
          {visualization.insightId && (
            <div className="border-t pt-4">
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
      }
    >
      <div className="h-full overflow-hidden">
        {hasEncodingErrors ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                <AlertCircleIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-200">
                Invalid encoding configuration
              </h3>
              <div className="space-y-2 text-sm text-red-700 dark:text-red-300">
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
              <p className="mt-4 text-xs text-red-600 dark:text-red-400">
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
