import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import {
  ArtifactCollection,
  ArtifactGrid,
  ArtifactEmptyState,
  ArtifactCard,
} from "@/components/artifacts/ArtifactCollection";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  isUnmodifiedDraft,
  type DataTable,
  type Insight,
  type UUID,
} from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@wystack/ui-react";
import {
  DeleteIcon,
  ExternalLinkIcon,
  FileIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { useInsightCanvasStore } from "@/lib/stores/insight-canvas-store";
import { resolveInsightSourceDataTable } from "@/hooks/useInsightPagination";

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

/**
 * Insights Management Page
 *
 * Shows all insights organized by state:
 * - With Visualizations: Insights that have 1+ visualizations
 * - Configured: Insights with fields/metrics but no visualizations
 * - Drafts: Unconfigured insights (can be cleaned up)
 */
export default function InsightsPage() {
  const navigate = useNavigate();

  const {
    data: allInsights = [],
    isPending: insightsPending,
    isLoadingError: insightsLoadError,
  } = queryStatus(useQuery({ query: api.app.listInsights, args: {} }));
  const commitBatch = useMutation(api.app.commitBatch);
  const { confirm } = useConfirmDialogStore();
  const clearActiveView = useInsightCanvasStore((s) => s.clearActiveView);
  const {
    data: visualizations = [],
    isPending: visualizationsPending,
    isLoadingError: visualizationsLoadError,
  } = queryStatus(useQuery({ query: api.app.listVisualizations, args: {} }));
  // Gate the state-based grouping (and its destructive "delete all drafts"
  // action) until BOTH queries have data. The draft classification depends on
  // `visualizations`; before the first successful load it defaults to `[]`, so
  // every insight — even populated ones — looks like an unconfigured draft.
  // An error in either subscription keeps destructive grouping unavailable.
  const isLoading = insightsPending || visualizationsPending;
  const hasLoadError = insightsLoadError || visualizationsLoadError;
  const { data: dataSources = [] } = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const { data: allDataTables = [] } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const hasActiveSearch = searchQuery.trim().length > 0;

  // Join insights with dataTables and count visualizations
  const insightsData = useMemo((): InsightWithDetails[] => {
    return allInsights.map((insight) => {
      // Find dataTable and sourceType
      let dataTable: DataTable | null = null;
      let sourceType: string | null = null;

      const table = resolveInsightSourceDataTable(
        insight,
        allDataTables,
        allInsights,
      );
      if (table) {
        dataTable = table;
        const ds = dataSources.find((s) => s.id === table.dataSourceId);
        if (ds) {
          sourceType = ds.type;
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
      const isConfigured = !isUnmodifiedDraft(item.insight);
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
    if (!hasActiveSearch) return insights;
    const query = searchQuery.trim().toLowerCase();
    return insights.filter(
      (item: InsightItem) =>
        item.insight.name.toLowerCase().includes(query) ||
        item.dataTable?.name.toLowerCase().includes(query),
    );
  }, [hasActiveSearch, insights, searchQuery]);

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

  // Handle delete insight
  const handleDeleteInsight = (
    insightId: UUID,
    name: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    confirm({
      title: "Delete insight",
      description: `Are you sure you want to delete "${name}"? This deletes the insight and its visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await commitBatch({
            commands: [cmd("DeleteNode", { id: insightId })],
          });
        } catch {
          toast.error("Couldn't delete the insight");
          return;
        }
        // Drop the persisted canvas-view entry so deleted insights don't
        // accumulate stale keys in localStorage.
        clearActiveView(insightId);
      },
    });
  };

  // Handle delete all drafts
  const handleDeleteAllDrafts = () => {
    // Never act on a classification computed while the queries are unsettled or
    // errored — during load, or after a load failure, the draft grouping is
    // untrustworthy (see the isLoading/hasLoadError note above).
    if (isLoading || hasLoadError) return;
    const draftCount = groupedInsights.drafts.length;
    const draftInsightLabel = `draft insight${draftCount === 1 ? "" : "s"}`;
    const description = hasActiveSearch
      ? `Are you sure you want to delete ${draftCount} matching ${draftInsightLabel}? This deletes the matching drafts and their visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.`
      : `Are you sure you want to delete all ${draftCount} ${draftInsightLabel}? This deletes the drafts and their visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.`;
    confirm({
      title: hasActiveSearch ? "Delete matching drafts" : "Delete drafts",
      description,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        for (const item of groupedInsights.drafts) {
          try {
            await commitBatch({
              commands: [cmd("DeleteNode", { id: item.insight.id })],
            });
          } catch {
            toast.error("Couldn't delete every draft — some may remain");
            return;
          }
          clearActiveView(item.insight.id);
        }
      },
    });
  };

  // Render insight card
  const renderInsightCard = (item: (typeof insights)[0]) => (
    <ArtifactCard
      key={item.insight.id}
      to={`/insights/${item.insight.id}`}
      name={item.insight.name}
      headingLevel={3}
      icon={<FileIcon className="h-5 w-5" />}
      metadata={
        <>
          {item.dataTable?.name || "Unknown table"}
          {item.sourceType && (
            <>
              <span aria-hidden="true"> · </span> {item.sourceType}
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
                navigate({ to: `/insights/${item.insight.id}` } as never);
              }}
            >
              <ExternalLinkIcon className="mr-2 h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-palette-danger"
              onClick={(e) =>
                handleDeleteInsight(
                  item.insight.id,
                  item.insight.name,
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

  return (
    <ArtifactCollection
      title="Insights"
      description={
        isLoading || hasLoadError ? undefined : (
          <>
            {insights.length} insight{insights.length !== 1 ? "s" : ""}
          </>
        )
      }
      actions={
        <Button
          icon={PlusIcon}
          label="New Insight"
          onClick={() => setIsCreateModalOpen(true)}
        />
      }
      searchLabel="Search insights"
      searchPlaceholder="Search insights..."
      itemCount={isLoading || hasLoadError ? undefined : insights.length}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      <div className="w-full space-y-8">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-neutral-fg-subtle">Loading insights…</p>
          </div>
        )}
        {!isLoading && hasLoadError && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-bg-muted">
              <FileIcon className="h-8 w-8 text-neutral-fg-subtle" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">
              Couldn&apos;t load insights
            </h3>
            <p className="mb-4 text-sm text-neutral-fg-subtle">
              Something went wrong. Check your connection and try again.
            </p>
            <Button
              variant="outline"
              label="Try again"
              onClick={() => globalThis.location.reload()}
            />
          </div>
        )}
        {!isLoading && !hasLoadError && (
          <>
            {/* With Visualizations */}
            {groupedInsights.withViz.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-fg-subtle">
                    With Visualizations ({groupedInsights.withViz.length})
                  </h2>
                </div>
                <ArtifactGrid>
                  {groupedInsights.withViz.map(renderInsightCard)}
                </ArtifactGrid>
              </section>
            )}

            {/* Configured */}
            {groupedInsights.configured.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-fg-subtle">
                    Configured ({groupedInsights.configured.length})
                  </h2>
                </div>
                <ArtifactGrid>
                  {groupedInsights.configured.map(renderInsightCard)}
                </ArtifactGrid>
              </section>
            )}

            {/* Drafts */}
            {groupedInsights.drafts.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-fg-subtle">
                    Drafts ({groupedInsights.drafts.length})
                  </h2>
                  <Button
                    variant="ghost"
                    icon={DeleteIcon}
                    label={hasActiveSearch ? "Delete matching" : "Delete all"}
                    size="sm"
                    color="danger"
                    className="text-palette-danger hover:text-palette-danger"
                    onClick={handleDeleteAllDrafts}
                  />
                </div>
                <ArtifactGrid>
                  {groupedInsights.drafts.map(renderInsightCard)}
                </ArtifactGrid>
              </section>
            )}

            {/* Empty State */}
            {filteredInsights.length === 0 && (
              <ArtifactEmptyState
                title={searchQuery ? "No insights found" : "No insights yet"}
                description={
                  searchQuery
                    ? `No insights match "${searchQuery}"`
                    : "Create your first insight to start analyzing data"
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
                      label="New Insight"
                      onClick={() => setIsCreateModalOpen(true)}
                    />
                  )
                }
              />
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </ArtifactCollection>
  );
}
