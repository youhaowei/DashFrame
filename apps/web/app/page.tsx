"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase } from "@dashframe/notion";
import type { TopLevelSpec } from "vega-lite";
import type { EnhancedDataFrame } from "@dashframe/dataframe";
import {
  Card,
  CardContent,
  BarChart3,
  Alert,
  AlertDescription,
  SectionList,
  Button,
  ItemCard,
  Badge,
  LineChart,
  Sparkles,
  Database,
  TableIcon,
} from "@dashframe/ui";
import { LuArrowLeft, LuArrowRight, LuCircleDot } from "react-icons/lu";

// Dynamic import to avoid SSR issues with Vega-Lite
const VegaChart = dynamic(
  () => import("@/components/visualizations/VegaChart").then((mod) => ({ default: mod.VegaChart })),
  { ssr: false }
);
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";
import { DataTableList } from "@/components/data-sources/DataTableList";
import { DataSourceList } from "@/components/data-sources/DataSourceList";
import type { DataSourceInfo } from "@/components/data-sources/DataSourceList";
import { useLocalStoreHydration } from "@/hooks/useLocalStoreHydration";
import { useDataTables } from "@/hooks/useDataTables";
import { useCSVUpload } from "@/hooks/useCSVUpload";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import type { DataSource, Visualization } from "@/lib/stores/types";

// Utility: Get CSS color variable value
function getCSSColor(variable: string): string {
  if (typeof window === "undefined") return "#000000";
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

// Utility: Get Vega theme config matching app theme
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

// Build Vega-Lite spec for preview (smaller height)
function buildPreviewVegaSpec(
  viz: Visualization,
  dataFrame: EnhancedDataFrame
): TopLevelSpec {
  const { visualizationType, encoding } = viz;

  // Common spec properties
  const commonSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json" as const,
    data: { values: dataFrame.data.rows },
    width: "container" as const,
    height: 180, // Smaller height for preview
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

/**
 * Home Page
 *
 * Shows onboarding flow when no visualizations exist,
 * or a dashboard overview when visualizations are present.
 */
export default function HomePage() {
  const router = useRouter();

  // Stores
  const { isHydrated, localSources } = useLocalStoreHydration();
  const { data: visualizations } = useStoreQuery(useVisualizationsStore, (state) => state.getAll());
  const { data: insights } = useStoreQuery(useInsightsStore, (state) => state.getAll());
  const { data: dataSources } = useStoreQuery(useDataSourcesStore, (state) => state.getAll());
  const getDataFrame = useDataFramesStore((state) => state.get);

  // Onboarding state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const { allDataTables } = useDataTables(localSources, selectedSourceId);
  const { handleCSVUpload, error: csvError, clearError: clearCSVError } = useCSVUpload();
  const { createInsightFromTable } = useCreateInsight();

  // Transform localSources for DataSourceList
  const dataSourcesInfo: DataSourceInfo[] = localSources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    tableCount: source.dataTables?.size || 0,
  }));

  // Notion UI state
  const [notionApiKey, setNotionApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [notionDatabases, setNotionDatabases] = useState<NotionDatabase[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);

  // Local store for Notion
  const setNotionDataSource = useDataSourcesStore((state) => state.setNotion);

  // Check for existing Notion source (local only)
  const notionSource = localSources.find((s) => s.type === "notion");

  // tRPC for Notion API
  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();

  // Handle CSV upload with insight creation
  const onCSVSelect = useCallback(
    (file: File) => {
      clearCSVError();
      handleCSVUpload(file, (dataTableId) => {
        const tableName = file.name.replace(/\.csv$/i, "");
        createInsightFromTable(dataTableId, tableName);
      });
    },
    [handleCSVUpload, createInsightFromTable, clearCSVError]
  );

  // Handle Notion connection
  const handleConnectNotion = useCallback(async () => {
    if (!notionApiKey) return;

    setNotionError(null);
    setIsLoadingDatabases(true);

    try {
      const databases = await listDatabasesMutation.mutateAsync({
        apiKey: notionApiKey,
      });

      if (!databases || databases.length === 0) {
        setNotionError("No databases found in your Notion workspace");
        setIsLoadingDatabases(false);
        return;
      }

      setNotionDatabases(databases);

      // Create or update Notion data source (LOCAL ONLY)
      if (!notionSource) {
        setNotionDataSource(notionApiKey, "Notion");
      }

      // For now, just show success - user will need to select database
      // In a full flow, you'd show a database selector next
      setNotionError("Notion connected! Please select a database to continue.");
      setIsLoadingDatabases(false);
    } catch (err) {
      setNotionError(
        err instanceof Error ? err.message : "Failed to connect to Notion"
      );
      setIsLoadingDatabases(false);
    }
  }, [notionApiKey, notionSource, listDatabasesMutation, setNotionDataSource]);

  const error = csvError || notionError;
  const hasDataSources = dataSourcesInfo.length > 0;
  const showWelcome = isHydrated && !hasDataSources;
  const hasVisualizations = visualizations.length > 0;

  // Get icon for visualization type
  const getTypeIcon = (type: string) => {
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
  };

  // Get label for visualization type
  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      table: "Table",
      bar: "Bar Chart",
      line: "Line Chart",
      scatter: "Scatter Plot",
      area: "Area Chart",
    };
    return labels[type] || "Chart";
  };

  // Recent items (last 3)
  const recentVisualizations = useMemo(() => {
    return [...visualizations]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
  }, [visualizations]);

  const recentInsights = useMemo(() => {
    return [...insights]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
  }, [insights]);

  // Stats
  const totalTables = useMemo(() => {
    return dataSources.reduce((acc: number, ds: DataSource) => acc + (ds.dataTables?.size || 0), 0);
  }, [dataSources]);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-12 max-w-4xl">
          {/* Onboarding View - Show when no visualizations exist */}
          {!hasVisualizations && (
            <>
              {/* Welcome Header - Only shown when completely empty */}
              {showWelcome && (
                <Card className="text-center mb-8">
                  <CardContent className="p-8">
                    {/* Icon */}
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <BarChart3 className="h-6 w-6 text-primary" />
                    </div>

                    {/* Heading */}
                    <h2 className="text-2xl font-bold mb-2">
                      Welcome to DashFrame
                    </h2>

                    {/* Description */}
                    <p className="text-muted-foreground text-base">
                      Create beautiful visualizations from your data.
                      Upload a CSV file or connect to Notion to get started.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Error Alert */}
              {error && (
                <Alert variant={error.includes("connected") ? "default" : "destructive"} className="mb-6">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Two-Level Hierarchy: Data Sources → Tables */}
              {isHydrated && hasDataSources && (
                <Card className="mb-6">
                  <CardContent className="p-6">
                    {/* Show data sources when no source is selected */}
                    {!selectedSourceId && (
                      <SectionList title="Your Data Sources">
                        <DataSourceList
                          sources={dataSourcesInfo}
                          selectedSourceId={selectedSourceId}
                          onSourceClick={setSelectedSourceId}
                        />
                      </SectionList>
                    )}

                    {/* Show tables when a source is selected */}
                    {selectedSourceId && (
                      <>
                        {/* Back button */}
                        <div className="mb-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedSourceId(null)}
                          >
                            <LuArrowLeft className="mr-2 h-4 w-4" />
                            Back to sources
                          </Button>
                        </div>

                        {/* Tables for selected source */}
                        <SectionList title="Tables">
                          <DataTableList
                            tables={allDataTables}
                            onTableClick={createInsightFromTable}
                          />
                        </SectionList>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Add Connection Panel */}
              <AddConnectionPanel
                onCsvSelect={onCSVSelect}
                csvTitle="Upload CSV File"
                csvDescription="Upload a CSV file with headers in the first row."
                csvHelperText="Supports .csv files up to 5MB"
                notion={{
                  apiKey: notionApiKey,
                  showApiKey,
                  onApiKeyChange: setNotionApiKey,
                  onToggleShowApiKey: () => setShowApiKey((prev) => !prev),
                  onConnectNotion: handleConnectNotion,
                  connectButtonLabel: isLoadingDatabases ? "Connecting..." : "Connect Notion",
                  connectDisabled: !notionApiKey || isLoadingDatabases,
                }}
              />
            </>
          )}

          {/* Dashboard View - Show when visualizations exist */}
          {hasVisualizations && (
            <>
              {/* Welcome Header */}
              <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Welcome back to DashFrame</h1>
                <p className="text-muted-foreground">
                  {visualizations.length} visualization{visualizations.length !== 1 ? "s" : ""} · {insights.length} insight{insights.length !== 1 ? "s" : ""} · {dataSources.length} data source{dataSources.length !== 1 ? "s" : ""} · {totalTables} table{totalTables !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Recent Visualizations */}
              {recentVisualizations.length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Recent Visualizations</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push("/visualizations")}
                    >
                      View all
                      <LuArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {recentVisualizations.map((viz) => {
                      // Get DataFrame for this visualization
                      const dataFrameId = viz.source.dataFrameId;
                      const dataFrame = dataFrameId ? getDataFrame(dataFrameId) : null;
                      const isChart = viz.visualizationType !== "table";

                      // Build preview element
                      const previewElement = isChart && dataFrame ? (
                        <VegaChart spec={buildPreviewVegaSpec(viz, dataFrame)} />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-muted">
                          {getTypeIcon(viz.visualizationType)}
                        </div>
                      );

                      return (
                        <ItemCard
                          key={viz.id}
                          preview={previewElement}
                          icon={getTypeIcon(viz.visualizationType)}
                          title={viz.name}
                          subtitle={`Created ${new Date(viz.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                          badge={getTypeLabel(viz.visualizationType)}
                          onClick={() => router.push(`/visualizations/${viz.id}`)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent Insights */}
              {recentInsights.length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Recent Insights</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push("/insights")}
                    >
                      View all
                      <LuArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {recentInsights.map((insight) => (
                      <ItemCard
                        key={insight.id}
                        icon={<Sparkles className="h-5 w-5" />}
                        title={insight.name}
                        subtitle={`${insight.metrics?.length || 0} metric${insight.metrics?.length !== 1 ? "s" : ""}`}
                        badge={insight.baseTable?.selectedFields.length ? `${insight.baseTable.selectedFields.length} fields` : undefined}
                        onClick={() => router.push(`/insights/${insight.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Links */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Quick Links</h2>
                <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                  <ItemCard
                    icon={<BarChart3 className="h-5 w-5" />}
                    title="All Visualizations"
                    subtitle={`${visualizations.length} total`}
                    onClick={() => router.push("/visualizations")}
                  />
                  <ItemCard
                    icon={<Sparkles className="h-5 w-5" />}
                    title="All Insights"
                    subtitle={`${insights.length} total`}
                    onClick={() => router.push("/insights")}
                  />
                  <ItemCard
                    icon={<Database className="h-5 w-5" />}
                    title="Data Sources"
                    subtitle={`${dataSources.length} connected`}
                    onClick={() => router.push("/data-sources")}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
