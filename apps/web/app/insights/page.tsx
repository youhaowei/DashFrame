"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@dashframe/convex";
import type { Id, Doc } from "@dashframe/convex/dataModel";

// Type for API response from listWithDetails
type InsightWithDetailsResponse = {
  insight: Doc<"insights">;
  dataTable: Doc<"dataTables"> | null;
  sourceType: string | null;
  visualizationCount: number;
};

// Type for processed insight with state
type InsightItem = InsightWithDetailsResponse & {
  isConfigured: boolean;
  hasVisualizations: boolean;
  state: "with-viz" | "configured" | "draft";
};
import {
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  BarChart3,
  Plus,
  Trash2,
  Settings,
  FileText,
  MoreHorizontal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashframe/ui";
import { LuSearch, LuExternalLink, LuLoader } from "react-icons/lu";
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

  // Convex queries
  const insightsData = useQuery(api.insights.listWithDetails);

  // Convex mutations
  const removeInsight = useMutation(api.insights.remove);

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Process insights data
  const insights = useMemo((): InsightItem[] => {
    if (!insightsData) return [];

    return insightsData.map((item: InsightWithDetailsResponse): InsightItem => {
      // Determine state
      const isConfigured = item.insight.selectedFieldIds.length > 0;
      const hasVisualizations = item.visualizationCount > 0;

      return {
        insight: item.insight,
        dataTable: item.dataTable,
        sourceType: item.sourceType,
        visualizationCount: item.visualizationCount,
        isConfigured,
        hasVisualizations,
        state: hasVisualizations
          ? ("with-viz" as const)
          : isConfigured
            ? ("configured" as const)
            : ("draft" as const),
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
        item.dataTable?.name.toLowerCase().includes(query)
    );
  }, [insights, searchQuery]);

  // Group insights by state
  const groupedInsights = useMemo(() => {
    return {
      withViz: filteredInsights.filter((i: InsightItem) => i.state === "with-viz"),
      configured: filteredInsights.filter((i: InsightItem) => i.state === "configured"),
      drafts: filteredInsights.filter((i: InsightItem) => i.state === "draft"),
    };
  }, [filteredInsights]);

  // Get state badge
  const getStateBadge = (
    state: "with-viz" | "configured" | "draft",
    vizCount?: number
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
        return <BarChart3 className="h-5 w-5 text-primary" />;
      case "configured":
        return <Settings className="h-5 w-5 text-muted-foreground" />;
      case "draft":
        return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  // Handle delete insight
  const handleDeleteInsight = async (
    insightId: Id<"insights">,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    e.preventDefault();
    await removeInsight({ id: insightId });
  };

  // Handle delete all drafts
  const handleDeleteAllDrafts = async () => {
    for (const item of groupedInsights.drafts) {
      await removeInsight({ id: item.insight._id });
    }
  };

  // Render insight card
  const renderInsightCard = (item: (typeof insights)[0]) => (
    <Card
      key={item.insight._id}
      className="group hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => router.push(`/insights/${item.insight._id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
            {getStateIcon(item.state)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium truncate">{item.insight.name}</h4>
              {getStateBadge(item.state, item.visualizationCount)}
            </div>
            <p className="text-xs text-muted-foreground">
              {item.dataTable?.name || "Unknown table"}
              {item.sourceType && ` • ${item.sourceType}`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
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
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/insights/${item.insight._id}`);
                }}
              >
                <LuExternalLink className="h-4 w-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) =>
                  handleDeleteInsight(
                    item.insight._id,
                    e as unknown as React.MouseEvent
                  )
                }
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );

  // Loading state - THIS FIXES THE HYDRATION ISSUE!
  if (insightsData === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Insights</h1>
              <p className="text-sm text-muted-foreground">
                {insights.length} insight{insights.length !== 1 ? "s" : ""}{" "}
                total
              </p>
            </div>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Insight
            </Button>
          </div>
          <div className="relative">
            <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
        <div className="container mx-auto px-6 py-6 max-w-4xl space-y-8">
          {/* With Visualizations */}
          {groupedInsights.withViz.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground">
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
                <h2 className="text-sm font-semibold text-muted-foreground">
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
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Drafts ({groupedInsights.drafts.length})
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDeleteAllDrafts}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete all
                </Button>
              </div>
              <div className="grid gap-3">
                {groupedInsights.drafts.map(renderInsightCard)}
              </div>
            </section>
          )}

          {/* Empty State */}
          {filteredInsights.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              {searchQuery ? (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    No insights found
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    No insights match "{searchQuery}"
                  </p>
                  <Button variant="outline" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    No insights yet
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first insight to start analyzing data
                  </p>
                  <Button onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Insight
                  </Button>
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
