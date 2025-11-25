"use client";

import { use, useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@dashframe/convex";
import type { Id, Doc } from "@dashframe/convex/dataModel";
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
  FieldLabel,
} from "@dashframe/ui";
import { LuArrowLeft, LuLoader, LuCircleDot } from "react-icons/lu";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { VegaChart } from "@/components/visualizations/VegaChart";
import { DataFrameTable } from "@dashframe/ui";
import { analyzeDataFrame, type ColumnAnalysis } from "@dashframe/dataframe";
import type { EnhancedDataFrame } from "@dashframe/dataframe";

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
function buildVegaSpec(
  viz: Doc<"visualizations">,
  dataFrame: EnhancedDataFrame
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

  // If no encoding is set, use defaults
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
          x: { field: x, type: (encoding?.xType || "nominal") as any },
          y: { field: y, type: (encoding?.yType || "quantitative") as any },
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
          x: { field: x, type: (encoding?.xType || "ordinal") as any },
          y: { field: y, type: (encoding?.yType || "quantitative") as any },
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
          x: { field: x, type: (encoding?.xType || "quantitative") as any },
          y: { field: y, type: (encoding?.yType || "quantitative") as any },
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
          x: { field: x, type: (encoding?.xType || "ordinal") as any },
          y: { field: y, type: (encoding?.yType || "quantitative") as any },
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
          x: { field: x, type: (encoding?.xType || "nominal") as any },
          y: { field: y, type: (encoding?.yType || "quantitative") as any },
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

  // Convex queries
  const visualization = useQuery(api.visualizations.get, {
    id: visualizationId as Id<"visualizations">,
  });
  const insight = useQuery(
    api.insights.get,
    visualization?.insightId ? { id: visualization.insightId } : "skip"
  );

  // Convex mutations
  const updateVisualization = useMutation(api.visualizations.update);
  const updateEncoding = useMutation(api.visualizations.updateEncoding);
  const removeVisualization = useMutation(api.visualizations.remove);

  // DataFrames store (client-side cached data)
  const getDataFrame = useDataFramesStore((state) => state.get);

  // Local state
  const [vizName, setVizName] = useState("");
  const [activeTab, setActiveTab] = useState<string>("chart");
  const [visibleRows, setVisibleRows] = useState<number>(10);

  // Refs for layout calculation
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Sync visualization name when data loads
  useEffect(() => {
    if (visualization?.name) {
      setVizName(visualization.name);
    }
  }, [visualization?.name]);

  // Watch container size for "Show Both" mode availability
  useEffect(() => {
    if (!containerRef.current || !headerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerHeight = entry.contentRect.height;
        const headerHeight = headerRef.current?.offsetHeight || 100;
        const chartHeight = 400;
        const spacing = 60;

        const availableForTable =
          containerHeight - headerHeight - chartHeight - spacing;
        const rowHeight = 30;
        const calculatedVisibleRows = Math.floor(availableForTable / rowHeight);

        setVisibleRows(calculatedVisibleRows);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visualization?._id]);

  // Get DataFrame from client-side store
  const dataFrame = useMemo(() => {
    if (!visualization?.dataFrameId) return null;
    return getDataFrame(visualization.dataFrameId);
  }, [visualization?.dataFrameId, getDataFrame]);

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

  // Handle name change
  const handleNameChange = async (newName: string) => {
    setVizName(newName);
    await updateVisualization({
      id: visualizationId as Id<"visualizations">,
      name: newName,
    });
  };

  // Handle encoding change
  const handleEncodingChange = async (
    field: "x" | "y" | "color" | "size",
    value: string
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

    await updateEncoding({
      id: visualizationId as Id<"visualizations">,
      encoding: newEncoding as any,
    });
  };

  // Handle visualization type change
  const handleTypeChange = async (type: string) => {
    await updateVisualization({
      id: visualizationId as Id<"visualizations">,
      visualizationType: type as any,
    });
  };

  // Handle delete
  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete "${visualization?.name}"?`)) {
      await removeVisualization({
        id: visualizationId as Id<"visualizations">,
      });
      router.push("/insights"); // Navigate back after delete
    }
  };

  // Loading state
  if (visualization === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Loading visualization...
          </p>
        </div>
      </div>
    );
  }

  // Not found state
  if (visualization === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Visualization not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The visualization you're looking for doesn't exist.
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
      <div className="flex h-screen flex-col bg-background">
        <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
              >
                <LuArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <h1 className="text-lg font-semibold">{visualization.name}</h1>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                {getVizIcon(visualization.visualizationType)}
              </div>
              <h3 className="text-lg font-semibold mb-2">Data not available</h3>
              <p className="text-sm text-muted-foreground mb-4">
                The data for this visualization is not cached locally. Please
                refresh from the source insight.
              </p>
              {visualization.insightId && (
                <Button
                  onClick={() =>
                    router.push(`/insights/${visualization.insightId}`)
                  }
                >
                  Go to Source Insight
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Visualization type options
  const hasNumericColumns = dataFrame.data.columns?.some(
    (col) => col.type === "number"
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
    <div ref={containerRef} className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header
        ref={headerRef}
        className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm"
      >
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
            >
              <LuArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex-1 min-w-[220px]">
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
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {dataFrame.metadata.rowCount.toLocaleString()} rows •{" "}
              {dataFrame.metadata.columnCount} columns
            </span>
            {insight && (
              <>
                <span>•</span>
                <button
                  onClick={() => router.push(`/insights/${insight._id}`)}
                  className="text-primary hover:underline"
                >
                  From: {insight.name}
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
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main chart/table display */}
        <div className="flex-1 overflow-auto">
          {visualization.visualizationType === "table" ? (
            <div className="h-full p-6">
              <Surface elevation="inset" className="h-full p-4">
                <DataFrameTable dataFrame={dataFrame.data} />
              </Surface>
            </div>
          ) : activeTab === "chart" ? (
            <div className="h-full p-6">
              <VegaChart spec={vegaSpec!} />
            </div>
          ) : activeTab === "table" ? (
            <div className="h-full p-6">
              <Surface elevation="inset" className="h-full">
                <DataFrameTable dataFrame={dataFrame.data} />
              </Surface>
            </div>
          ) : (
            // Both view
            <div className="flex h-full flex-col p-6 gap-4">
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

        {/* Sidebar controls (only for chart types) */}
        {visualization.visualizationType !== "table" && (
          <aside className="w-72 border-l bg-card overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-3">Encodings</h3>

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
                <h3 className="text-sm font-semibold mb-3">Chart Type</h3>
                <SelectField
                  label=""
                  value={visualization.visualizationType}
                  onChange={handleTypeChange}
                  options={vizTypeOptions}
                />
              </div>

              {/* Source insight link */}
              {insight && (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold mb-2">Source</h3>
                  <Card
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/insights/${insight._id}`)}
                  >
                    <CardContent className="p-3">
                      <p className="text-sm font-medium truncate">
                        {insight.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {insight.selectedFieldIds.length} fields selected
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
