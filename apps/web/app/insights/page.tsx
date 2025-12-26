"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useInsights,
  useInsightMutations,
  useVisualizations,
  useDataSources,
  useDataTables,
} from "@dashframe/core";
import type { Insight, DataTable, UUID } from "@dashframe/types";

// Type for insight with joined details
type InsightWithDetails = {
  insight: Insight;
  dataTable: DataTable | null;
  sourceType: string | null;
  visualizationCount: number;
};

// Type alias for insight state
type InsightState = "with-viz" | "configured" | "draft";

// Type for processed insight with state
type InsightItem = InsightWithDetails & {
  isConfigured: boolean;
  hasVisualizations: boolean;
  state: InsightState;
};

// Helper to determine insight state
function getInsightState(
  hasVisualizations: boolean,
  isConfigured: boolean,
): InsightState {
  if (hasVisualizations) return "with-viz";
  if (isConfigured) return "configured";
  return "draft";
}
import {
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  ChartIcon,
  PlusIcon,
  DeleteIcon,
  SettingsIcon,
  FileIcon,
  MoreIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashframe/ui";
import { SearchIcon, ExternalLinkIcon } from "@dashframe/ui/icons";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";

/**
 * Insights Management Page
 *
 * Shows all insights organized by state:
 * - With Visualizations: Insights that have 1+ visualizations
 * - Configured: Insights with fields/metrics but no visualizations
 * - Drafts: Unconfigured insights (can be cleaned up)
 */
export default function InsightsPage() {
  const router = useRouter();

  // Dexie hooks
  const { data: allInsights = [] } = useInsights();
  const { remove: removeInsightLocal } = useInsightMutations();
  const { data: visualizations = [] } = useVisualizations();
  const { data: dataSources = [] } = useDataSources();
  const { data: allDataTables = [] } = useDataTables();

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Join insights with dataTables and count visualizations
  const insightsData = useMemo((): InsightWithDetails[] => {
    return allInsights.map((insight) => {
      // Find dataTable and sourceType
      let dataTable: DataTable | null = null;
      let sourceType: string | null = null;

      const dataTableId = insight.baseTableId;
      if (dataTableId) {
        // Find the data table (flat in Dexie)
        const table = allDataTables.find((t) => t.id === dataTableId);
        if (table) {
          dataTable = table;
          // Find the data source for this table
          const ds = dataSources.find((s) => s.id === table.dataSourceId);
          if (ds) {
            sourceType = ds.type;
          }
        }
      }

      // Count visualizations for this insight
      const visualizationCount = visualizations.filter(
        (viz) => viz.insightId === insight.id,
      ).length;

      return {
        insight,
        dataTable,
        sourceType,
        visualizationCount,
      };
    });
  }, [allInsights, allDataTables, dataSources, visualizations]);

  // Process insights data
  const insights = useMemo((): InsightItem[] => {
    return insightsData.map((item): InsightItem => {
      // Determine state
      const isConfigured = (item.insight.selectedFields?.length ?? 0) > 0;
      const hasVisualizations = item.visualizationCount > 0;

      return {
        ...item,
        isConfigured,
        hasVisualizations,
        state: getInsightState(hasVisualizations, isConfigured),
      };
    });
  }, [insightsData]);

  // Filter insights by search query
  const filteredInsights = useMemo((): InsightItem[] => {
    if (!searchQuery.trim()) return insights;
    const query = searchQuery.toLowerCase();
    return insights.filter(
      (item: InsightItem) =>
        item.insight.name.toLowerCase().includes(query) ||
        item.dataTable?.name.toLowerCase().includes(query),
    );
  }, [insights, searchQuery]);

  // Group insights by state
  const groupedInsights = useMemo(() => {
    return {
      withViz: filteredInsights.filter(
        (i: InsightItem) => i.state === "with-viz",
      ),
      configured: filteredInsights.filter(
        (i: InsightItem) => i.state === "configured",
      ),
      drafts: filteredInsights.filter((i: InsightItem) => i.state === "draft"),
    };
  }, [filteredInsights]);

  // Get state badge
  const getStateBadge = (
    state: "with-viz" | "configured" | "draft",
    vizCount?: number,
  ) => {
    switch (state) {
      case "with-viz":
        return (
          <Badge variant="default" className="text-xs">
            {vizCount} viz{vizCount !== 1 ? "s" : ""}
          </Badge>
        );
      case "configured":
        return (
          <Badge variant="secondary" className="text-xs">
            Configured
          </Badge>
        );
      case "draft":
        return (
          <Badge variant="outline" className="text-xs">
            Draft
          </Badge>
        );
    }
  };

  // Get icon for state
  const getStateIcon = (state: "with-viz" | "configured" | "draft") => {
    switch (state) {
      case "with-viz":
        return <ChartIcon className="text-primary h-5 w-5" />;
      case "configured":
        return <SettingsIcon className="text-muted-foreground h-5 w-5" />;
      case "draft":
        return <FileIcon className="text-muted-foreground h-5 w-5" />;
    }
  };

  // Handle delete insight
  const handleDeleteInsight = async (insightId: UUID, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await removeInsightLocal(insightId);
  };

  // Handle delete all drafts
  const handleDeleteAllDrafts = async () => {
    for (const item of groupedInsights.drafts) {
      await removeInsightLocal(item.insight.id);
    }
  };

  // Render insight card
  const renderInsightCard = (item: (typeof insights)[0]) => (
    <Card
      key={item.insight.id}
      className="group cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => router.push(`/insights/${item.insight.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="bg-muted flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
            {getStateIcon(item.state)}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h4 className="truncate font-medium">{item.insight.name}</h4>
              {getStateBadge(item.state, item.visualizationCount)}
            </div>
            <p className="text-muted-foreground text-xs">
              {item.dataTable?.name || "Unknown table"}
              {item.sourceType && ` • ${item.sourceType}`}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Created{" "}
              {new Date(item.insight.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="text"
                icon={MoreIcon}
                iconOnly
                label="More options"
                size="sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => {}}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/insights/${item.insight.id}`);
                }}
              >
                <ExternalLinkIcon className="mr-2 h-4 w-4" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) =>
                  handleDeleteInsight(
                    item.insight.id,
                    e as unknown as React.MouseEvent,
                  )
                }
              >
                <DeleteIcon className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="bg-background flex h-screen flex-col">
      {/* Header */}
      <header className="bg-card/90 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Insights</h1>
              <p className="text-muted-foreground text-sm">
                {insights.length} insight{insights.length !== 1 ? "s" : ""}{" "}
                total
              </p>
            </div>
            <Button
              icon={PlusIcon}
              label="New Insight"
              onClick={() => setIsCreateModalOpen(true)}
            />
          </div>
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search insights..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl space-y-8 px-6 py-6">
          {/* With Visualizations */}
          {groupedInsights.withViz.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-muted-foreground text-sm font-semibold">
                  With Visualizations ({groupedInsights.withViz.length})
                </h2>
              </div>
              <div className="grid gap-3">
                {groupedInsights.withViz.map(renderInsightCard)}
              </div>
            </section>
          )}

          {/* Configured */}
          {groupedInsights.configured.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-muted-foreground text-sm font-semibold">
                  Configured ({groupedInsights.configured.length})
                </h2>
              </div>
              <div className="grid gap-3">
                {groupedInsights.configured.map(renderInsightCard)}
              </div>
            </section>
          )}

          {/* Drafts */}
          {groupedInsights.drafts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-muted-foreground text-sm font-semibold">
                  Drafts ({groupedInsights.drafts.length})
                </h2>
                <Button
                  variant="text"
                  icon={DeleteIcon}
                  label="Delete all"
                  size="sm"
                  color="danger"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDeleteAllDrafts}
                />
              </div>
              <div className="grid gap-3">
                {groupedInsights.drafts.map(renderInsightCard)}
              </div>
            </section>
          )}

          {/* Empty State */}
          {filteredInsights.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <FileIcon className="text-muted-foreground h-8 w-8" />
              </div>
              {searchQuery ? (
                <>
                  <h3 className="mb-2 text-lg font-semibold">
                    No insights found
                  </h3>
                  <p className="text-muted-foreground mb-4 text-sm">
                    No insights match &quot;{searchQuery}&quot;
                  </p>
                  <Button
                    variant="outlined"
                    label="Clear search"
                    onClick={() => setSearchQuery("")}
                  />
                </>
              ) : (
                <>
                  <h3 className="mb-2 text-lg font-semibold">
                    No insights yet
                  </h3>
                  <p className="text-muted-foreground mb-4 text-sm">
                    Create your first insight to start analyzing data
                  </p>
                  <Button
                    icon={PlusIcon}
                    label="New Insight"
                    onClick={() => setIsCreateModalOpen(true)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Create Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
