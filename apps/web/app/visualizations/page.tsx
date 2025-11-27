"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import type { Visualization, Insight } from "@/lib/stores/types";
import type { UUID } from "@dashframe/dataframe";
import {
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  BarChart3,
  LineChart,
  TableIcon,
  Plus,
  Trash2,
  MoreHorizontal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashframe/ui";
import { LuSearch, LuExternalLink, LuCircleDot } from "react-icons/lu";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";

// Type for visualization with joined details
type VisualizationWithDetails = {
  visualization: Visualization;
  insight: Insight | null;
  sourceType: string | null;
};

/**
 * Visualizations Management Page
 *
 * Shows all visualizations with their linked insights.
 * Click a visualization to open it in the detail view.
 */
export default function VisualizationsPage() {
  const router = useRouter();

  // Local stores with useStoreQuery to prevent infinite loops
  const { data: visualizations } = useStoreQuery(useVisualizationsStore, (state) => state.getAll());
  const removeVisualizationLocal = useVisualizationsStore((state) => state.remove);
  const getInsight = useInsightsStore((state) => state.getInsight);
  const { data: dataSources } = useStoreQuery(useDataSourcesStore, (state) => state.getAll());

  // Local state
  const [searchQuery, setSearchQuery] = useState("");

  // Join visualizations with insights and determine source type
  const visualizationsData = useMemo((): VisualizationWithDetails[] => {
    return visualizations.map((viz) => {
      const insight = viz.source.insightId ? (getInsight(viz.source.insightId) ?? null) : null;

      // Try to determine source type from insight -> dataTable -> dataSource
      let sourceType: string | null = null;
      if (insight) {
        const dataTableId = insight.baseTable?.tableId;
        if (dataTableId) {
          // Find which data source contains this table
          const dataSource = dataSources.find((ds) =>
            Array.from(ds.dataTables.values()).some((dt) => dt.id === dataTableId)
          );
          if (dataSource) {
            sourceType = dataSource.type;
          }
        }
      }

      return {
        visualization: viz,
        insight,
        sourceType,
      };
    });
  }, [visualizations, getInsight, dataSources]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Filter visualizations by search query
  const filteredVisualizations = useMemo((): VisualizationWithDetails[] => {
    if (!visualizationsData) return [];
    if (!searchQuery.trim()) return visualizationsData;
    const query = searchQuery.toLowerCase();
    return visualizationsData.filter(
      (item: VisualizationWithDetails) =>
        item.visualization.name.toLowerCase().includes(query) ||
        item.insight?.name.toLowerCase().includes(query) ||
        item.visualization.visualizationType.toLowerCase().includes(query)
    );
  }, [visualizationsData, searchQuery]);

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

  // Handle delete visualization (LOCAL ONLY)
  const handleDeleteVisualization = (
    visualizationId: UUID,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    e.preventDefault();
    removeVisualizationLocal(visualizationId);
  };

  // Render visualization card
  const renderVisualizationCard = (item: VisualizationWithDetails) => (
    <Card
      key={item.visualization.id}
      className="group hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => router.push(`/visualizations/${item.visualization.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
            {getTypeIcon(item.visualization.visualizationType)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium truncate">{item.visualization.name}</h4>
              <Badge variant="secondary" className="text-xs">
                {getTypeLabel(item.visualization.visualizationType)}
              </Badge>
            </div>
            {item.insight && (
              <p className="text-xs text-muted-foreground">
                From: {item.insight.name}
                {item.sourceType && ` • ${item.sourceType}`}
              </p>
            )}
            {item.visualization.encoding && (
              <p className="text-xs text-muted-foreground">
                {item.visualization.encoding.x && `X: ${item.visualization.encoding.x}`}
                {item.visualization.encoding.x && item.visualization.encoding.y && " • "}
                {item.visualization.encoding.y && `Y: ${item.visualization.encoding.y}`}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Created{" "}
              {new Date(item.visualization.createdAt).toLocaleDateString("en-US", {
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
                  router.push(`/visualizations/${item.visualization.id}`);
                }}
              >
                <LuExternalLink className="h-4 w-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) =>
                  handleDeleteVisualization(
                    item.visualization.id,
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

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Visualizations</h1>
              <p className="text-sm text-muted-foreground">
                {visualizationsData.length} visualization{visualizationsData.length !== 1 ? "s" : ""}{" "}
                created
              </p>
            </div>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Visualization
            </Button>
          </div>
          <div className="relative">
            <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search visualizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-6 max-w-4xl">
          {/* Visualizations List */}
          {filteredVisualizations.length > 0 ? (
            <div className="grid gap-3">
              {filteredVisualizations.map(renderVisualizationCard)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <BarChart3 className="h-8 w-8 text-muted-foreground" />
              </div>
              {searchQuery ? (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    No visualizations found
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    No visualizations match "{searchQuery}"
                  </p>
                  <Button variant="outline" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    No visualizations yet
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first visualization to see your data come to life
                  </p>
                  <Button onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Visualization
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
