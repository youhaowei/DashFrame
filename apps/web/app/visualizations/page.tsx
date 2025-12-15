"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useVisualizations,
  useVisualizationMutations,
  useInsights,
  useDataSources,
  useDataTables,
} from "@dashframe/core";
import type { Visualization, Insight, UUID } from "@dashframe/types";
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

  // Dexie hooks for data
  const { data: visualizations = [], isLoading: isLoadingViz } =
    useVisualizations();
  const { data: insights = [] } = useInsights();
  const { data: dataSources = [] } = useDataSources();
  const { data: dataTables = [] } = useDataTables();
  const { remove: removeVisualization } = useVisualizationMutations();

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Create lookup maps for efficient joins
  const insightsMap = useMemo(
    () => new Map(insights.map((i) => [i.id, i])),
    [insights],
  );

  const dataTablesMap = useMemo(
    () => new Map(dataTables.map((t) => [t.id, t])),
    [dataTables],
  );

  const dataSourcesMap = useMemo(
    () => new Map(dataSources.map((s) => [s.id, s])),
    [dataSources],
  );

  // Join visualizations with insights and determine source type
  const visualizationsData = useMemo((): VisualizationWithDetails[] => {
    return visualizations.map((viz) => {
      const insight = viz.insightId
        ? (insightsMap.get(viz.insightId) ?? null)
        : null;

      // Try to determine source type from insight -> dataTable -> dataSource
      let sourceType: string | null = null;
      const dataTableId = insight?.baseTableId;
      if (dataTableId) {
        const dataTable = dataTablesMap.get(dataTableId);
        if (dataTable) {
          const dataSource = dataSourcesMap.get(dataTable.dataSourceId);
          sourceType = dataSource?.type ?? null;
        }
      }

      return {
        visualization: viz,
        insight,
        sourceType,
      };
    });
  }, [visualizations, insightsMap, dataTablesMap, dataSourcesMap]);

  // Filter visualizations by search query
  const filteredVisualizations = useMemo((): VisualizationWithDetails[] => {
    if (!visualizationsData) return [];
    if (!searchQuery.trim()) return visualizationsData;
    const query = searchQuery.toLowerCase();
    return visualizationsData.filter(
      (item: VisualizationWithDetails) =>
        item.visualization.name.toLowerCase().includes(query) ||
        item.insight?.name.toLowerCase().includes(query) ||
        item.visualization.visualizationType.toLowerCase().includes(query),
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

  // Handle delete visualization
  const handleDeleteVisualization = async (
    visualizationId: UUID,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    await removeVisualization(visualizationId);
  };

  // Render visualization card
  const renderVisualizationCard = (item: VisualizationWithDetails) => (
    <Card
      key={item.visualization.id}
      className="group cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => router.push(`/visualizations/${item.visualization.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="bg-muted flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
            {getTypeIcon(item.visualization.visualizationType)}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h4 className="truncate font-medium">
                {item.visualization.name}
              </h4>
              <Badge variant="secondary" className="text-xs">
                {getTypeLabel(item.visualization.visualizationType)}
              </Badge>
            </div>
            {item.insight && (
              <p className="text-muted-foreground text-xs">
                From: {item.insight.name}
                {item.sourceType && ` • ${item.sourceType}`}
              </p>
            )}
            {item.visualization.encoding && (
              <p className="text-muted-foreground text-xs">
                {item.visualization.encoding.x &&
                  `X: ${item.visualization.encoding.x}`}
                {item.visualization.encoding.x &&
                  item.visualization.encoding.y &&
                  " • "}
                {item.visualization.encoding.y &&
                  `Y: ${item.visualization.encoding.y}`}
              </p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              Created{" "}
              {new Date(item.visualization.createdAt).toLocaleDateString(
                "en-US",
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                },
              )}
            </p>
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
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
                <LuExternalLink className="mr-2 h-4 w-4" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) =>
                  handleDeleteVisualization(
                    item.visualization.id,
                    e as unknown as React.MouseEvent,
                  )
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );

  // Show loading state
  if (isLoadingViz) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading visualizations...</div>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-screen flex-col">
      {/* Header */}
      <header className="bg-card/90 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Visualizations</h1>
              <p className="text-muted-foreground text-sm">
                {visualizationsData.length} visualization
                {visualizationsData.length !== 1 ? "s" : ""} created
              </p>
            </div>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Visualization
            </Button>
          </div>
          <div className="relative">
            <LuSearch className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
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
        <div className="container mx-auto max-w-4xl px-6 py-6">
          {/* Visualizations List */}
          {filteredVisualizations.length > 0 ? (
            <div className="grid gap-3">
              {filteredVisualizations.map(renderVisualizationCard)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <BarChart3 className="text-muted-foreground h-8 w-8" />
              </div>
              {searchQuery ? (
                <>
                  <h3 className="mb-2 text-lg font-semibold">
                    No visualizations found
                  </h3>
                  <p className="text-muted-foreground mb-4 text-sm">
                    No visualizations match &quot;{searchQuery}&quot;
                  </p>
                  <Button variant="outline" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="mb-2 text-lg font-semibold">
                    No visualizations yet
                  </h3>
                  <p className="text-muted-foreground mb-4 text-sm">
                    Create your first visualization to see your data come to
                    life
                  </p>
                  <Button onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
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
