"use client";

import { use, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@dashframe/convex";
import type { Id } from "@dashframe/convex/dataModel";
import {
  Button,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Badge,
} from "@dashframe/ui";
import { LuArrowLeft, LuLoader } from "react-icons/lu";
import { InsightConfigureTab } from "@/components/insights/InsightConfigureTab";
import { InsightPreviewTab } from "@/components/insights/InsightPreviewTab";

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Adaptive Insight Page
 *
 * This page adapts based on the insight's configuration state:
 * - Unconfigured (draft): Shows data preview + chart suggestions + join action
 * - Configured: Shows insight configuration editor + preview tab with visualizations
 */
export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);
  const router = useRouter();

  // Convex queries
  const insight = useQuery(api.insights.get, { id: insightId as Id<"insights"> });
  const dataTableWithFields = useQuery(
    api.dataTables.getWithFieldsAndMetrics,
    insight ? { id: insight.baseTableId } : "skip"
  );
  const dataSource = useQuery(
    api.dataSources.get,
    dataTableWithFields?.dataTable ? { id: dataTableWithFields.dataTable.dataSourceId } : "skip"
  );
  const visualizations = useQuery(
    api.visualizations.getByInsight,
    { insightId: insightId as Id<"insights"> }
  );
  const insightMetrics = useQuery(
    api.insights.getWithMetrics,
    { id: insightId as Id<"insights"> }
  );

  // Convex mutations
  const updateInsight = useMutation(api.insights.update);

  // Local state
  const [insightName, setInsightName] = useState("");
  const [activeTab, setActiveTab] = useState("configure");

  // Sync insight name when data loads
  useEffect(() => {
    if (insight?.name) {
      setInsightName(insight.name);
    }
  }, [insight?.name]);

  // Determine if insight is configured
  const isConfigured = useMemo(() => {
    if (!insight) return false;
    return insight.selectedFieldIds.length > 0;
  }, [insight]);

  // Determine status badge
  const statusBadge = useMemo(() => {
    const vizCount = visualizations?.length ?? 0;
    if (vizCount > 0) {
      return { label: "With visualizations", variant: "default" as const };
    }
    if (isConfigured) {
      return { label: "Configured", variant: "secondary" as const };
    }
    return { label: "Draft", variant: "outline" as const };
  }, [isConfigured, visualizations]);

  // Get data source type label
  const dataSourceTypeLabel = useMemo(() => {
    if (!dataSource?.type) return "unknown source";
    switch (dataSource.type) {
      case "notion":
        return "Notion database";
      case "local":
        return "Uploaded CSV";
      case "postgresql":
        return "PostgreSQL source";
      default:
        return "unknown source";
    }
  }, [dataSource]);

  // Handle name change
  const handleNameChange = async (newName: string) => {
    setInsightName(newName);
    await updateInsight({
      id: insightId as Id<"insights">,
      name: newName,
    });
  };

  // Extract data from the combined query
  const dataTable = dataTableWithFields?.dataTable ?? null;
  const fields = dataTableWithFields?.fields ?? [];
  const tableMetrics = dataTableWithFields?.metrics ?? [];
  const insightMetricsList = insightMetrics?.metrics ?? [];

  // Loading state - THIS FIXES THE HYDRATION ISSUE!
  if (
    insight === undefined ||
    dataTableWithFields === undefined ||
    dataSource === undefined ||
    visualizations === undefined ||
    insightMetrics === undefined
  ) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading insight...</p>
        </div>
      </div>
    );
  }

  // Error states (null means not found, undefined means loading)
  if (insight === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The insight you're looking for doesn't exist.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </div>
      </div>
    );
  }

  if (dataTableWithFields === null || dataTable === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Data table not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The data table for this insight no longer exists.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/insights")}
            >
              <LuArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex-1 min-w-[220px]">
              <Input
                value={insightName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Insight name"
                className="w-full"
              />
            </div>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{dataTable.name}</span>
            <span>•</span>
            <span>{dataSourceTypeLabel}</span>
            {visualizations.length > 0 && (
              <>
                <span>•</span>
                <span>
                  {visualizations.length} visualization
                  {visualizations.length !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="border-b bg-card">
          <div className="container mx-auto px-6">
            <TabsList className="h-12">
              <TabsTrigger value="configure" className="px-6">
                Configure
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="px-6"
                disabled={!isConfigured && visualizations.length === 0}
              >
                Preview
                {visualizations.length > 0 && (
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                    {visualizations.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="configure" className="flex-1 overflow-hidden mt-0">
          <InsightConfigureTab
            insightId={insightId as Id<"insights">}
            insight={insight}
            dataTable={dataTable}
            fields={fields}
            tableMetrics={tableMetrics}
            insightMetrics={insightMetricsList}
            dataSource={dataSource}
            isConfigured={isConfigured}
          />
        </TabsContent>

        <TabsContent value="preview" className="flex-1 overflow-hidden mt-0">
          <InsightPreviewTab
            insightId={insightId as Id<"insights">}
            insight={insight}
            visualizations={visualizations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
