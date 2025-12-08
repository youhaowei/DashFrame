"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase } from "@dashframe/notion";

import {
  Card,
  CardContent,
  BarChart3,
  Alert,
  AlertDescription,
  SectionList,
  Button,
  ItemCard,
  LineChart,
  Sparkles,
  Database,
  TableIcon,
} from "@dashframe/ui";
import { LuArrowLeft, LuArrowRight, LuCircleDot } from "react-icons/lu";

import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";
import { DataTableList } from "@/components/data-sources/DataTableList";
import { DataSourceList } from "@/components/data-sources/DataSourceList";
import type { DataSourceInfo } from "@/components/data-sources/DataSourceList";
import { useDataTables } from "@/hooks/useDataTables";
import { useCSVUpload } from "@/hooks/useCSVUpload";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import type { DataSource } from "@/lib/stores/types";

/**
 * Home Page
 *
 * Shows onboarding flow when no visualizations exist,
 * or a dashboard overview when visualizations are present.
 */
export default function HomePage() {
  const router = useRouter();

  // Stores
  const { data: visualizations } = useStoreQuery(
    useVisualizationsStore,
    (state) => state.getAll(),
  );
  const { data: insights } = useStoreQuery(useInsightsStore, (state) =>
    state.getAll(),
  );
  const { data: dataSources } = useStoreQuery(useDataSourcesStore, (state) =>
    state.getAll(),
  );

  // Onboarding state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const { allDataTables } = useDataTables(dataSources, selectedSourceId);
  const {
    handleCSVUpload,
    error: csvError,
    clearError: clearCSVError,
  } = useCSVUpload();
  const { createInsightFromTable } = useCreateInsight();

  // Transform dataSources for DataSourceList
  const dataSourcesInfo: DataSourceInfo[] = dataSources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    tableCount: source.dataTables?.size || 0,
  }));

  // Notion UI state
  const [notionApiKey, setNotionApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [, setNotionDatabases] = useState<NotionDatabase[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);

  // Local store for Notion
  const setNotionDataSource = useDataSourcesStore((state) => state.setNotion);

  // Check for existing Notion source (local only)
  const notionSource = dataSources.find((s) => s.type === "notion");

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
    [handleCSVUpload, createInsightFromTable, clearCSVError],
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
        err instanceof Error ? err.message : "Failed to connect to Notion",
      );
      setIsLoadingDatabases(false);
    }
  }, [notionApiKey, notionSource, listDatabasesMutation, setNotionDataSource]);

  const error = csvError || notionError;
  const hasDataSources = dataSourcesInfo.length > 0;
  // showWelcome happens when no visualizations exist
  // We've removed hasDataSources check here to simplify - if no viz, show simplified view
  // Actually, original logic was: showWelcome = isHydrated && !hasDataSources
  // Now we just check !hasDataSources if that was the intent.
  // But strictly, showWelcome was likely used to show the "Empty State" card.
  // Let's keep it simple: if no visualizations, we show onboarding.
  // Within onboarding, if no sources, we show the welcome card.
  const showWelcome = !hasDataSources;
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

  // Recent items (last 3)
  const recentVisualizations = useMemo(() => {
    return [...visualizations]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 3);
  }, [visualizations]);

  const recentInsights = useMemo(() => {
    return [...insights]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 3);
  }, [insights]);

  // Stats
  const totalTables = useMemo(() => {
    return dataSources.reduce(
      (acc: number, ds: DataSource) => acc + (ds.dataTables?.size || 0),
      0,
    );
  }, [dataSources]);

  return (
    <div className="bg-background flex h-screen flex-col">
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl px-6 py-12">
          {/* Onboarding View - Show when no visualizations exist */}
          {!hasVisualizations && (
            <>
              {/* Welcome Header - Only shown when completely empty */}
              {showWelcome && (
                <Card className="mb-8 text-center">
                  <CardContent className="p-8">
                    {/* Icon */}
                    <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                      <BarChart3 className="text-primary h-6 w-6" />
                    </div>

                    {/* Heading */}
                    <h2 className="mb-2 text-2xl font-bold">
                      Welcome to DashFrame
                    </h2>

                    {/* Description */}
                    <p className="text-muted-foreground text-base">
                      Create beautiful visualizations from your data. Upload a
                      CSV file or connect to Notion to get started.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Error Alert */}
              {error && (
                <Alert
                  variant={
                    error.includes("connected") ? "default" : "destructive"
                  }
                  className="mb-6"
                >
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Two-Level Hierarchy: Data Sources → Tables */}
              {hasDataSources && (
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
                  connectButtonLabel: isLoadingDatabases
                    ? "Connecting..."
                    : "Connect Notion",
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
                <h1 className="mb-2 text-3xl font-bold">
                  Welcome back to DashFrame
                </h1>
                <p className="text-muted-foreground">
                  {visualizations.length} visualization
                  {visualizations.length !== 1 ? "s" : ""} · {insights.length}{" "}
                  insight{insights.length !== 1 ? "s" : ""} ·{" "}
                  {dataSources.length} data source
                  {dataSources.length !== 1 ? "s" : ""} · {totalTables} table
                  {totalTables !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Recent Visualizations */}
              {recentVisualizations.length > 0 && (
                <div className="mb-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">
                      Recent Visualizations
                    </h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push("/visualizations")}
                    >
                      View all
                      <LuArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {recentVisualizations.map((viz) => (
                      <ItemCard
                        key={viz.id}
                        preview={
                          <VisualizationPreview
                            visualization={viz}
                            height={180}
                            fallback={getTypeIcon(viz.visualizationType)}
                          />
                        }
                        title={viz.name}
                        subtitle={`Created ${new Date(viz.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        onClick={() => router.push(`/visualizations/${viz.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Insights */}
              {recentInsights.length > 0 && (
                <div className="mb-8">
                  <div className="mb-4 flex items-center justify-between">
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
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {recentInsights.map((insight) => (
                      <ItemCard
                        key={insight.id}
                        icon={<Sparkles className="h-5 w-5" />}
                        title={insight.name}
                        subtitle={`${insight.metrics?.length || 0} metric${insight.metrics?.length !== 1 ? "s" : ""}`}
                        badge={
                          insight.baseTable?.selectedFields.length
                            ? `${insight.baseTable.selectedFields.length} fields`
                            : undefined
                        }
                        onClick={() => router.push(`/insights/${insight.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Links */}
              <div>
                <h2 className="mb-4 text-xl font-semibold">Quick Links</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
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
