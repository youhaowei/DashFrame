"use client";

import { use, useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { TopLevelSpec } from "vega-lite";
import {
  Button,
  Input,
  Badge,
  Card,
  CardContent,
  Toggle,
  Surface,
  BarChart3,
  LineChart,
  TableIcon,
  Layers,
  Trash2,
  SelectField,
} from "@dashframe/ui";
import { LuArrowLeft, LuLoader, LuCircleDot } from "react-icons/lu";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import { VegaChart } from "@/components/visualizations/VegaChart";
import { DataFrameTable } from "@dashframe/ui";
import { analyzeDataFrame, type ColumnAnalysis } from "@dashframe/dataframe";
import type { EnhancedDataFrame, UUID } from "@dashframe/dataframe";
import type { Visualization, VisualizationType } from "@/lib/stores/types";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";

// StandardType is not exported from vega-lite's main module
type StandardType = "quantitative" | "ordinal" | "temporal" | "nominal";

interface PageProps {
  params: Promise<{ visualizationId: string }>;
}

// Minimum visible rows needed to enable "Show Both" mode
const MIN_VISIBLE_ROWS_FOR_BOTH = 5;

// Helper to get CSS variable color value
function getCSSColor(variable: string): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || "#000000";
}

// Get theme-aware Vega-Lite config
function getVegaThemeConfig() {
  return {
    background: getCSSColor("--color-card"),
    view: {
      stroke: getCSSColor("--color-border"),
      strokeWidth: 1,
    },
    axis: {
      domainColor: getCSSColor("--color-border"),
      gridColor: getCSSColor("--color-border"),
      tickColor: getCSSColor("--color-border"),
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
    legend: {
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
    title: {
      color: getCSSColor("--color-foreground"),
      font: "inherit",
    },
  };
}

// Build Vega-Lite spec from visualization and dataframe
// NOTE: The dataframe should already contain pre-computed/aggregated data.
// The visualization just renders what's in the dataframe.
function buildVegaSpec(
  viz: Visualization,
  dataFrame: EnhancedDataFrame,
): TopLevelSpec {
  const { visualizationType, encoding } = viz;

  // Common spec properties
  const commonSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json" as const,
    data: { values: dataFrame.data.rows },
    width: "container" as const,
    height: 400,
    config: getVegaThemeConfig(),
  };

  // Get field names from encoding or fall back to dataframe columns
  const x = encoding?.x || dataFrame.data.columns?.[0]?.name || "x";
  const y =
    encoding?.y ||
    dataFrame.data.columns?.find((col) => col.type === "number")?.name ||
    dataFrame.data.columns?.[1]?.name ||
    "y";

  switch (visualizationType) {
    case "bar":
      return {
        ...commonSpec,
        mark: { type: "bar" as const, stroke: null },
        encoding: {
          x: { field: x, type: (encoding?.xType || "nominal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    case "line":
      return {
        ...commonSpec,
        mark: "line" as const,
        encoding: {
          x: { field: x, type: (encoding?.xType || "ordinal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    case "scatter":
      return {
        ...commonSpec,
        mark: "point" as const,
        encoding: {
          x: {
            field: x,
            type: (encoding?.xType || "quantitative") as StandardType,
          },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
          ...(encoding?.size && {
            size: { field: encoding.size, type: "quantitative" as const },
          }),
        },
      };

    case "area":
      return {
        ...commonSpec,
        mark: "area" as const,
        encoding: {
          x: { field: x, type: (encoding?.xType || "ordinal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    default:
      // Fallback to bar chart
      return {
        ...commonSpec,
        mark: { type: "bar" as const, stroke: null },
        encoding: {
          x: { field: x, type: (encoding?.xType || "nominal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
        },
      };
  }
}

// Get icon for visualization type
function getVizIcon(type: string) {
  switch (type) {
    case "bar":
      return <BarChart3 className="h-5 w-5" />;
    case "line":
    case "area":
      return <LineChart className="h-5 w-5" />;
    case "scatter":
      return <LuCircleDot className="h-5 w-5" />;
    case "table":
    default:
      return <TableIcon className="h-5 w-5" />;
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

  // Local stores with hydration awareness
  const { data: visualization, isLoading: isVizLoading } = useStoreQuery(
    useVisualizationsStore,
    (s) => s.get(visualizationId as UUID),
  );
  const updateVisualizationLocal = useVisualizationsStore(
    (state) => state.update,
  );
  const updateEncodingLocal = useVisualizationsStore(
    (state) => state.updateEncoding,
  );
  const removeVisualizationLocal = useVisualizationsStore(
    (state) => state.remove,
  );

  const { data: getDataFrame, isLoading: isDfLoading } = useStoreQuery(
    useDataFramesStore,
    (s) => s.get,
  );

  const isLoading = isVizLoading || isDfLoading;

  // Local state
  const [vizName, setVizName] = useState("");
  const [activeTab, setActiveTab] = useState<string>("chart");
  const [visibleRows, setVisibleRows] = useState<number>(10);

  // Refs for layout calculation
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync visualization name when data loads
  useEffect(() => {
    if (visualization?.name) {
      setVizName(visualization.name);
    }
  }, [visualization?.name]);

  // Watch container size for "Show Both" mode availability
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerHeight = entry.contentRect.height;
        // No header height needed as we are measuring the content area directly
        const chartHeight = 400;
        const spacing = 60;

        const availableForTable = containerHeight - chartHeight - spacing;
        const rowHeight = 30;
        const calculatedVisibleRows = Math.floor(availableForTable / rowHeight);

        setVisibleRows(calculatedVisibleRows);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visualization?.id]);

  // Get DataFrame from client-side store
  const dataFrame = useMemo(() => {
    if (!visualization?.source.dataFrameId) return null;
    return getDataFrame(visualization.source.dataFrameId);
  }, [visualization?.source.dataFrameId, getDataFrame]);

  // Build Vega spec
  const vegaSpec = useMemo(() => {
    if (!visualization || !dataFrame) return null;
    if (visualization.visualizationType === "table") return null;
    return buildVegaSpec(visualization, dataFrame);
  }, [visualization, dataFrame]);

  // Analyze columns for encoding suggestions
  const columnAnalysis = useMemo<ColumnAnalysis[]>(() => {
    if (!dataFrame) return [];
    return analyzeDataFrame(dataFrame);
  }, [dataFrame]);

  // Get column options for selects
  const columnOptions = useMemo(() => {
    if (!dataFrame) return [];
    return (dataFrame.data.columns || []).map((col) => ({
      label: col.name,
      value: col.name,
    }));
  }, [dataFrame]);

  // Check if enough space for "Both" view
  const canShowBoth = visibleRows >= MIN_VISIBLE_ROWS_FOR_BOTH;

  // Auto-switch tabs based on space availability
  const previousStateRef = useRef({ canShowBoth, activeTab });
  useEffect(() => {
    const prev = previousStateRef.current;
    const canShowBothChanged = prev.canShowBoth !== canShowBoth;

    if (canShowBothChanged) {
      if (canShowBoth && activeTab !== "both") {
        setActiveTab("both");
      } else if (!canShowBoth && activeTab === "both") {
        setActiveTab("chart");
      }
    }
    previousStateRef.current = { canShowBoth, activeTab };
  }, [canShowBoth, activeTab]);

  // Handle name change (LOCAL ONLY)
  const handleNameChange = (newName: string) => {
    setVizName(newName);
    updateVisualizationLocal(visualizationId as UUID, { name: newName });
  };

  // Handle encoding change (LOCAL ONLY)
  const handleEncodingChange = (
    field: "x" | "y" | "color" | "size",
    value: string,
  ) => {
    if (!visualization) return;

    const newEncoding = { ...visualization.encoding, [field]: value };

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

    updateEncodingLocal(visualizationId as UUID, newEncoding);
  };

  // Handle visualization type change (LOCAL ONLY)
  const handleTypeChange = (type: string) => {
    updateVisualizationLocal(visualizationId as UUID, {
      visualizationType: type as VisualizationType,
    });
  };

  // Handle delete (LOCAL ONLY)
  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${visualization?.name}"?`)) {
      removeVisualizationLocal(visualizationId as UUID);
      router.push("/insights"); // Navigate back after delete
    }
  };

  // Loading state - wait for all stores to hydrate before rendering
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

  // Not found state (local store returns undefined if not found)
  if (!visualization) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Visualization not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The visualization you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </div>
      </div>
    );
  }

  // No DataFrame state (data not cached locally)
  if (!dataFrame) {
    return (
      <WorkbenchLayout
        header={
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => router.back()}>
                <LuArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
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
                The data for this visualization is not cached locally. Please
                refresh from the source insight.
              </p>
              {visualization.source.insightId && (
                <Button
                  onClick={() =>
                    router.push(`/insights/${visualization.source.insightId}`)
                  }
                >
                  Go to Source Insight
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </WorkbenchLayout>
    );
  }

  // Visualization type options
  const hasNumericColumns = dataFrame.data.columns?.some(
    (col) => col.type === "number",
  );
  const vizTypeOptions = hasNumericColumns
    ? [
        { label: "Table", value: "table" },
        { label: "Bar Chart", value: "bar" },
        { label: "Line Chart", value: "line" },
        { label: "Scatter Plot", value: "scatter" },
        { label: "Area Chart", value: "area" },
      ]
    : [{ label: "Table", value: "table" }];

  return (
    <WorkbenchLayout
      header={
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              <LuArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
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
              {dataFrame.metadata.rowCount.toLocaleString()} rows •{" "}
              {dataFrame.metadata.columnCount} columns
            </span>
            {visualization.source.insightId && (
              <>
                <span>•</span>
                <button
                  onClick={() =>
                    router.push(`/insights/${visualization.source.insightId}`)
                  }
                  className="text-primary hover:underline"
                >
                  From insight
                </button>
              </>
            )}
          </div>

          {/* View toggle (only for chart types) */}
          {visualization.visualizationType !== "table" && (
            <div className="mt-3 flex items-center justify-between">
              <Toggle
                variant="default"
                value={activeTab}
                onValueChange={setActiveTab}
                options={[
                  {
                    value: "chart",
                    icon: <BarChart3 className="h-4 w-4" />,
                    label: "Chart",
                  },
                  {
                    value: "table",
                    icon: <TableIcon className="h-4 w-4" />,
                    label: "Data",
                  },
                  {
                    value: "both",
                    icon: <Layers className="h-4 w-4" />,
                    label: "Both",
                    disabled: !canShowBoth,
                    tooltip: canShowBoth
                      ? "Show chart and table"
                      : "Not enough space",
                  },
                ]}
              />

              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
            </div>
          )}
        </div>
      }
      rightPanel={
        visualization.visualizationType !== "table" ? (
          <div className="space-y-4 p-4">
            <div>
              <h3 className="mb-3 text-sm font-semibold">Encodings</h3>

              <div className="space-y-3">
                <SelectField
                  label="X Axis"
                  value={visualization.encoding?.x || ""}
                  onChange={(value) => handleEncodingChange("x", value)}
                  options={columnOptions}
                  placeholder="Select column..."
                />

                <SelectField
                  label="Y Axis"
                  value={visualization.encoding?.y || ""}
                  onChange={(value) => handleEncodingChange("y", value)}
                  options={columnOptions}
                  placeholder="Select column..."
                />

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
            {visualization.source.insightId && (
              <div className="border-t pt-4">
                <h3 className="mb-2 text-sm font-semibold">Source</h3>
                <Card
                  className="hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() =>
                    router.push(`/insights/${visualization.source.insightId}`)
                  }
                >
                  <CardContent className="p-3">
                    <p className="truncate text-sm font-medium">
                      Source Insight
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Click to view insight details
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      <div ref={containerRef} className="h-full overflow-hidden">
        {/* Table-only visualization */}
        {visualization.visualizationType === "table" && (
          <div className="h-full p-6">
            <Surface elevation="inset" className="h-full p-4">
              <DataFrameTable dataFrame={dataFrame.data} />
            </Surface>
          </div>
        )}

        {/* Chart visualization - chart tab */}
        {visualization.visualizationType !== "table" &&
          activeTab === "chart" && (
            <div className="h-full p-6">
              <VegaChart spec={vegaSpec!} />
            </div>
          )}

        {/* Chart visualization - table tab */}
        {visualization.visualizationType !== "table" &&
          activeTab === "table" && (
            <div className="h-full p-6">
              <Surface elevation="inset" className="h-full">
                <DataFrameTable dataFrame={dataFrame.data} />
              </Surface>
            </div>
          )}

        {/* Chart visualization - both view */}
        {visualization.visualizationType !== "table" &&
          activeTab === "both" && (
            <div className="flex h-full flex-col gap-4 p-6">
              <div className="shrink-0">
                <VegaChart spec={vegaSpec!} />
              </div>
              <div className="min-h-0 flex-1">
                <Surface elevation="inset" className="h-full">
                  <DataFrameTable dataFrame={dataFrame.data} />
                </Surface>
              </div>
            </div>
          )}
      </div>
    </WorkbenchLayout>
  );
}
