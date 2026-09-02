import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import {
  ArtifactCollection,
  ArtifactGrid,
  ArtifactEmptyState,
  ArtifactCard,
} from "@/components/artifacts/ArtifactCollection";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import { useConfirmDialogStore } from "@/lib/stores";
import { resolveInsightSourceDataTable } from "@/hooks/useInsightPagination";
import { api } from "@/wystack/api";
import {
  cmd,
  type Insight,
  type UUID,
  type Visualization,
} from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@wystack/client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@wystack/ui-react";
import {
  ChartIcon,
  DataPointIcon,
  DeleteIcon,
  ExternalLinkIcon,
  PlusIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
  const navigate = useNavigate();

  const { data: visualizations = [], isLoading: isLoadingViz } = useQuery(
    api.listVisualizations,
    { args: {} },
  );
  const { data: insights = [] } = useQuery(api.listInsights, { args: {} });
  const { data: dataSources = [] } = useQuery(api.listDataSources);
  const { data: dataTables = [] } = useQuery(api.listDataTables, { args: {} });
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);
  const { confirm } = useConfirmDialogStore();

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Create lookup maps for efficient joins
  const insightsMap = useMemo(
    () => new Map(insights.map((i) => [i.id, i])),
    [insights],
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
      const dataTable = resolveInsightSourceDataTable(
        insight,
        dataTables,
        insights,
      );
      if (dataTable) {
        const dataSource = dataSourcesMap.get(dataTable.dataSourceId);
        sourceType = dataSource?.type ?? null;
      }

      return {
        visualization: viz,
        insight,
        sourceType,
      };
    });
  }, [visualizations, insightsMap, dataTables, insights, dataSourcesMap]);

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
        return <ChartIcon className="h-5 w-5" />;
      case "line":
      case "area":
        return <ChartIcon className="h-5 w-5" />;
      case "scatter":
        return <DataPointIcon className="h-5 w-5" />;
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
  const handleDeleteVisualization = (
    visualizationId: UUID,
    name: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    confirm({
      title: "Delete visualization",
      description: `Are you sure you want to delete "${name}"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await commitBatch({
            commands: [cmd("DeleteNode", { id: visualizationId })],
          });
        } catch {
          toast.error("Couldn't delete the visualization");
        }
      },
    });
  };

  // Render visualization row
  const renderVisualizationCard = (item: VisualizationWithDetails) => (
    <ArtifactCard
      key={item.visualization.id}
      to={`/visualizations/${item.visualization.id}`}
      name={item.visualization.name}
      icon={getTypeIcon(item.visualization.visualizationType)}
      metadata={
        <>
          {getTypeLabel(item.visualization.visualizationType)}
          {item.insight && (
            <>
              <span aria-hidden="true"> · </span> From: {item.insight.name}
              {item.sourceType && (
                <>
                  <span aria-hidden="true"> · </span> {item.sourceType}
                </>
              )}
            </>
          )}
          {(item.visualization.encoding?.x ||
            item.visualization.encoding?.y) && (
            <>
              <span aria-hidden="true"> · </span>{" "}
              {item.visualization.encoding.x &&
                `X: ${item.visualization.encoding.x}`}
              {item.visualization.encoding.x &&
                item.visualization.encoding.y &&
                " · "}
              {item.visualization.encoding.y &&
                `Y: ${item.visualization.encoding.y}`}
            </>
          )}
        </>
      }
      actions={
        <DropdownMenu>
          <RoutedCardActionMenuTrigger />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                navigate({
                  to: `/visualizations/${item.visualization.id}`,
                } as never);
              }}
            >
              <ExternalLinkIcon className="mr-2 h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-palette-danger"
              onClick={(e) =>
                handleDeleteVisualization(
                  item.visualization.id,
                  item.visualization.name,
                  e as unknown as React.MouseEvent,
                )
              }
            >
              <DeleteIcon className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );

  // Show loading state
  if (isLoadingViz) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <div className="text-neutral-fg-subtle">Loading visualizations...</div>
      </div>
    );
  }

  return (
    <ArtifactCollection
      title="Visualizations"
      description={
        <>
          {visualizationsData.length} visualization
          {visualizationsData.length !== 1 ? "s" : ""}
        </>
      }
      actions={
        <Button
          icon={PlusIcon}
          label="New Visualization"
          onClick={() => setIsCreateModalOpen(true)}
        />
      }
      searchLabel="Search visualizations"
      searchPlaceholder="Search visualizations..."
      itemCount={visualizationsData.length}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      {filteredVisualizations.length > 0 ? (
        <ArtifactGrid>
          {filteredVisualizations.map(renderVisualizationCard)}
        </ArtifactGrid>
      ) : (
        <ArtifactEmptyState
          title={
            searchQuery ? "No visualizations found" : "No visualizations yet"
          }
          description={
            searchQuery
              ? `No visualizations match "${searchQuery}"`
              : "Create your first visualization to see your data come to life"
          }
          action={
            searchQuery ? (
              <Button
                variant="outline"
                label="Clear search"
                onClick={() => setSearchQuery("")}
              />
            ) : (
              <Button
                icon={PlusIcon}
                label="New Visualization"
                onClick={() => setIsCreateModalOpen(true)}
              />
            )
          }
        />
      )}

      {/* Create Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        visualizeOnCreate
      />
    </ArtifactCollection>
  );
}
