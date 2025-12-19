"use client";

import { use, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  PrimitiveButton,
  Input,
  Badge,
  Card,
  CardContent,
  BarChart3,
  LineChart,
  Trash2,
  SelectField,
} from "@dashframe/ui";
import {
  LuArrowLeft,
  LuLoader,
  LuCircleDot,
  LuArrowLeftRight,
  LuTriangleAlert,
} from "react-icons/lu";
import {
  isSwapAllowed,
  getSwappedChartType,
  validateEncoding,
} from "@/lib/visualizations/encoding-enforcer";
import {
  useVisualizations,
  useVisualizationMutations,
  useInsights,
  useCompiledInsight,
  useDataTables,
  getDataFrame as getDexieDataFrame,
} from "@dashframe/core";
import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";
import { AxisSelectField } from "@/components/visualizations/AxisSelectField";
import { getColumnIcon } from "@/lib/utils/field-icons";
import {
  Insight,
  analyzeInsight,
  type ColumnAnalysis,
} from "@dashframe/engine-browser";
import type {
  UUID,
  DataFrameColumn,
  DataFrameRow,
  VisualizationType,
  VisualizationEncoding,
} from "@dashframe/types";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { AppLayout } from "@/components/layouts/AppLayout";
import {
  computeInsightPreview,
  type PreviewResult,
} from "@/lib/insights/compute-preview";
import { useDuckDB } from "@/components/providers/DuckDBProvider";

interface PageProps {
  params: Promise<{ visualizationId: string }>;
}

// Get icon for visualization type
function getVizIcon(type: string) {
  switch (type) {
    case "bar":
    case "barHorizontal":
      return <BarChart3 className="h-5 w-5" />;
    case "line":
    case "area":
      return <LineChart className="h-5 w-5" />;
    case "scatter":
      return <LuCircleDot className="h-5 w-5" />;
    default:
      return <BarChart3 className="h-5 w-5" />;
  }
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
export default function VisualizationPage({ params }: PageProps) {
  const { visualizationId } = use(params);
  const router = useRouter();

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

  // Find the insight (raw - for building insightObj for DuckDB)
  const insight = useMemo(
    () =>
      visualization?.insightId
        ? insights.find((i) => i.id === visualization.insightId)
        : undefined,
    [insights, visualization?.insightId],
  );

  // Get compiled insight with resolved dimensions (for AxisSelectField)
  const { data: compiledInsight } = useCompiledInsight(
    visualization?.insightId,
  );

  // Find the data table
  const dataTable = useMemo(
    () =>
      insight?.baseTableId
        ? dataTables.find((t) => t.id === insight.baseTableId)
        : undefined,
    [dataTables, insight?.baseTableId],
  );

  // Get the dataFrameId from the dataTable
  const dataFrameId = dataTable?.dataFrameId;

  // Load source DataFrame data async
  const {
    data: sourceDataFrame,
    isLoading: isDataLoading,
    entry: dataFrameEntry,
  } = useDataFrameData(dataFrameId);

  // DuckDB connection for join computation
  const { connection: duckDBConnection, isInitialized: isDuckDBReady } =
    useDuckDB();

  // State for DuckDB-computed joined data (when insight has joins)
  const [joinedData, setJoinedData] = useState<{
    rows: DataFrameRow[];
    columns: DataFrameColumn[];
  } | null>(null);
  const [isLoadingJoinedData, setIsLoadingJoinedData] = useState(false);

  // Compute joined data using DuckDB when insight has joins
  useEffect(() => {
    // Skip if no joins configured
    if (!insight?.joins?.length) {
      setJoinedData(null);
      return;
    }

    // Wait for DuckDB to be ready
    if (!duckDBConnection || !isDuckDBReady) {
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
        for (const join of insight.joins ?? []) {
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
            ? Object.keys(rows[0])
                .filter((key) => !key.startsWith("_"))
                .map((name) => ({
                  name,
                  type:
                    typeof rows[0][name] === "number"
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
    insight?.joins,
    insight?.id,
    duckDBConnection,
    isDuckDBReady,
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
    if (joinedData) {
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
  }, [joinedData, aggregatedPreview, sourceDataFrame]);

  // Include dataFrame check to prevent "Data not available" flash
  const isLoading =
    isVizLoading ||
    isDataLoading ||
    isLoadingJoinedData ||
    (visualization && !dataFrame);

  // Local state
  const [vizName, setVizName] = useState("");

  // Sync visualization name when data loads
  useEffect(() => {
    if (visualization?.name) {
      setVizName(visualization.name);
    }
  }, [visualization?.name]);

  // State for DuckDB-computed column analysis
  const [columnAnalysis, setColumnAnalysis] = useState<ColumnAnalysis[]>([]);

  // Build Insight object from store data for analysis
  const insightObj = useMemo(() => {
    if (!insight || !dataTable) return null;

    // Build DataTableInfo for base table
    const baseTableInfo = {
      id: dataTable.id,
      name: dataTable.name,
      dataFrameId: dataTable.dataFrameId,
      fields: dataTable.fields ?? [],
    };

    // Build joins with full table info (mapping store types → engine types)
    // Store: { rightTableId, leftKey, rightKey, type }
    // Engine: { table, selectedFields, joinOn: {baseField, joinedField}, joinType }
    const resolvedJoins = insight.joins
      ?.map((join) => {
        const joinTable = dataTables.find((t) => t.id === join.rightTableId);
        if (!joinTable) return null;

        // Find field IDs by column name
        const baseField = dataTable.fields?.find(
          (f) => f.columnName === join.leftKey || f.name === join.leftKey,
        )?.id;
        const joinedField = joinTable.fields?.find(
          (f) => f.columnName === join.rightKey || f.name === join.rightKey,
        )?.id;

        if (!baseField || !joinedField) return null;

        // Map join type: store uses "full", engine uses "outer"
        const joinType =
          join.type === "full"
            ? "outer"
            : (join.type as "inner" | "left" | "right" | "outer");

        return {
          table: {
            id: joinTable.id,
            name: joinTable.name,
            dataFrameId: joinTable.dataFrameId,
            fields: joinTable.fields ?? [],
          },
          selectedFields: [] as string[], // No field selection in store join config
          joinOn: { baseField, joinedField },
          joinType,
        };
      })
      .filter(Boolean) as
      | Array<{
          table: {
            id: string;
            name: string;
            dataFrameId?: string;
            fields: Array<{
              id: string;
              name: string;
              columnName?: string;
              type?: string;
            }>;
          };
          selectedFields: string[];
          joinOn: { baseField: string; joinedField: string };
          joinType: "inner" | "left" | "right" | "outer";
        }>
      | undefined;

    return new Insight({
      id: insight.id,
      name: insight.name ?? "Untitled",
      baseTable: baseTableInfo,
      selectedFields: insight.selectedFields,
      metrics: insight.metrics,
      joins: resolvedJoins,
      // Note: filters omitted - store format doesn't match FilterPredicate
    });
  }, [insight, dataTable, dataTables]);

  // Run DuckDB analysis on Insight result (handles joins/aggregation)
  useEffect(() => {
    if (!duckDBConnection || !isDuckDBReady) return;
    if (!insightObj) {
      setColumnAnalysis([]);
      return;
    }

    const runAnalysis = async () => {
      try {
        const results = await analyzeInsight(duckDBConnection, insightObj);
        setColumnAnalysis(results);
      } catch (e) {
        console.error("[VisualizationPage] Analysis failed:", e);
        setColumnAnalysis([]);
      }
    };
    runAnalysis();
  }, [duckDBConnection, isDuckDBReady, insightObj]);

  // Get column options for Color/Size selects (derived from compiledInsight)
  // Includes icons to show column types
  const columnOptions = useMemo(() => {
    if (!compiledInsight) return [];

    const metricNames = new Set(compiledInsight.metrics.map((m) => m.name));
    const options: Array<{
      label: string;
      value: string;
      icon: React.ComponentType<{ className?: string }>;
    }> = [];

    // Add dimensions (resolved Field objects from compiledInsight)
    compiledInsight.dimensions.forEach((field) => {
      options.push({
        label: field.name,
        value: field.name,
        icon: getColumnIcon(field.name, columnAnalysis, metricNames),
      });
    });

    // Add metrics using their display names
    compiledInsight.metrics.forEach((metric) => {
      options.push({
        label: metric.name,
        value: metric.name,
        icon: getColumnIcon(metric.name, columnAnalysis, metricNames),
      });
    });

    return options;
  }, [compiledInsight, columnAnalysis]);

  // Validate encoding configuration - returns errors for X/Y if invalid
  const encodingErrors = useMemo(() => {
    if (!visualization || columnAnalysis.length === 0) return {};
    return validateEncoding(
      visualization.encoding ?? {},
      visualization.visualizationType,
      columnAnalysis,
      compiledInsight ?? undefined,
    );
  }, [visualization, columnAnalysis, compiledInsight]);

  // Check if there are any encoding errors
  const hasEncodingErrors = !!(encodingErrors.x || encodingErrors.y);

  // Handle name change
  const handleNameChange = async (newName: string) => {
    setVizName(newName);
    await updateVisualization(visualizationId as UUID, { name: newName });
  };

  // Handle encoding change
  const handleEncodingChange = async (
    field: "x" | "y" | "color" | "size",
    value: string,
  ) => {
    if (!visualization) return;

    const newEncoding: VisualizationEncoding = {
      ...visualization.encoding,
      [field]: value,
    };

    // Auto-detect type if changing x or y
    if (field === "x" || field === "y") {
      const colAnalysis = columnAnalysis.find((c) => c.columnName === value);
      const typeField = field === "x" ? "xType" : "yType";

      if (colAnalysis) {
        let axisType: "quantitative" | "nominal" | "ordinal" | "temporal" =
          "nominal";
        if (colAnalysis.category === "numerical") {
          axisType = "quantitative";
        } else if (colAnalysis.category === "temporal") {
          axisType = "temporal";
        }
        newEncoding[typeField] = axisType;
      }
    }

    await updateEncoding(visualizationId as UUID, newEncoding);
  };

  // Handle visualization type change
  // Auto-swaps axes when switching between bar and barHorizontal
  const handleTypeChange = async (type: string) => {
    const newType = type as VisualizationType;
    const currentType = visualization?.visualizationType;

    // Check if switching between bar orientations - auto-swap axes
    const isBarSwitch =
      (currentType === "bar" && newType === "barHorizontal") ||
      (currentType === "barHorizontal" && newType === "bar");

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
      router.push("/insights");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="text-muted-foreground h-8 w-8 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Loading visualization...
          </p>
        </div>
      </div>
    );
  }

  // Not found state
  if (!visualization) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Visualization not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The visualization you&apos;re looking for doesn&apos;t exist.
          </p>
          <PrimitiveButton
            onClick={() => router.push("/insights")}
            className="mt-4"
          >
            Go to Insights
          </PrimitiveButton>
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
              <PrimitiveButton
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
              >
                <LuArrowLeft className="mr-2 h-4 w-4" />
                Back
              </PrimitiveButton>
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
              <p className="text-muted-foreground mb-4 text-sm">
                The data for this visualization is not available. Please refresh
                from the source insight.
              </p>
              {visualization.insightId && (
                <PrimitiveButton
                  onClick={() =>
                    router.push(`/insights/${visualization.insightId}`)
                  }
                >
                  Go to Source Insight
                </PrimitiveButton>
              )}
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // Visualization type options
  const hasNumericColumns = dataFrame?.columns?.some(
    (col) => col.type === "number",
  );
  const vizTypeOptions = hasNumericColumns
    ? [
        { label: "Vertical Bar", value: "bar" },
        { label: "Horizontal Bar", value: "barHorizontal" },
        { label: "Line Chart", value: "line" },
        { label: "Scatter Plot", value: "scatter" },
        { label: "Area Chart", value: "area" },
      ]
    : [];

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
            <PrimitiveButton
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
            >
              <LuArrowLeft className="mr-2 h-4 w-4" />
              Back
            </PrimitiveButton>
            <div className="min-w-[220px] flex-1">
              <Input
                value={vizName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Visualization name"
                className="w-full"
              />
            </div>
            <Badge variant="secondary">{visualization.visualizationType}</Badge>
          </div>

          {/* Metadata row */}
          <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span>
              {dataFrameEntry?.rowCount?.toLocaleString() ?? "?"} rows •{" "}
              {dataFrameEntry?.columnCount ?? "?"} columns
            </span>
            {visualization.insightId && (
              <>
                <span>•</span>
                <button
                  onClick={() =>
                    router.push(`/insights/${visualization.insightId}`)
                  }
                  className="text-primary hover:underline"
                >
                  From insight
                </button>
              </>
            )}
          </div>

          {/* Delete button */}
          <div className="mt-3 flex items-center justify-end">
            <PrimitiveButton
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </PrimitiveButton>
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
                  otherAxisColumn={visualization.encoding?.y}
                  onSwapAxes={canSwap ? handleSwapAxes : undefined}
                />
              )}

              {/* Swap button - swaps axes and toggles bar orientation */}
              {canSwap && (
                <div className="flex justify-center">
                  <PrimitiveButton
                    variant="ghost"
                    size="sm"
                    onClick={handleSwapAxes}
                    className="text-muted-foreground hover:text-foreground"
                    title="Swap X and Y axes"
                  >
                    <LuArrowLeftRight className="mr-1.5 h-4 w-4" />
                    Swap
                  </PrimitiveButton>
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

              {visualization.visualizationType === "scatter" && (
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
              value={visualization.visualizationType}
              onChange={handleTypeChange}
              options={vizTypeOptions}
            />
          </div>

          {/* Source insight link */}
          {visualization.insightId && (
            <div className="border-t pt-4">
              <h3 className="mb-2 text-sm font-semibold">Source</h3>
              <Card
                className="hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() =>
                  router.push(`/insights/${visualization.insightId}`)
                }
              >
                <CardContent className="p-3">
                  <p className="truncate text-sm font-medium">Source Insight</p>
                  <p className="text-muted-foreground text-xs">
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
                <LuTriangleAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
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
