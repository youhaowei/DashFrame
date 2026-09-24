import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useConfirmDialogStore, useToastStore } from "@/lib/stores";
import {
  indexReportContents,
  resolveReportContents,
} from "@/lib/reports/report-contents";
import {
  ArtifactCard,
  ArtifactCollection,
  ArtifactEmptyState,
  ArtifactGrid,
} from "@/components/artifacts/ArtifactCollection";
import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import { resolveInsightSourceDataTable } from "@/hooks/useInsightPagination";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type Dashboard,
  type UUID,
  type Visualization,
} from "@dashframe/types";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  Input,
} from "@wystack/ui-react";
import {
  DashboardIcon,
  DeleteIcon,
  ExternalLinkIcon,
  FileIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { type ReactNode, useMemo, useState } from "react";

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_START_QUESTIONS = 5;
const UNTITLED_REPORT = "Untitled report";

type CreateReport = (
  name: string,
  firstVisualizationId?: UUID,
) => Promise<boolean>;

function touchedAt(row: { createdAt: number; updatedAt?: number }) {
  return Math.max(row.createdAt, row.updatedAt ?? 0);
}

/**
 * Recent questions that are on no report, each paired with the saved view that
 * would become the report's first tile. A report item places a saved view, so
 * a question without one has nothing to place and is left out.
 */
function useUnplacedRecentQuestions(
  dashboards: readonly Dashboard[],
  visualizations: readonly Visualization[],
) {
  const insightsQuery = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  );
  const tablesQuery = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const sourcesQuery = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const insights = insightsQuery.data;
  const dataTables = tablesQuery.data;
  const dataSources = sourcesQuery.data;
  // "Recent" is judged once, when the empty state opens.
  const [openedAt] = useState(() => Date.now());

  const candidates = useMemo(() => {
    if (!insights) return [];
    const indexes = indexReportContents(visualizations);
    const placed = new Set(
      dashboards.flatMap(
        (dashboard) => resolveReportContents(dashboard, indexes).questionIds,
      ),
    );
    const latestViewByQuestion = new Map<string, Visualization>();
    for (const view of visualizations) {
      const current = latestViewByQuestion.get(view.insightId);
      if (!current || touchedAt(view) > touchedAt(current)) {
        latestViewByQuestion.set(view.insightId, view);
      }
    }
    const cutoff = openedAt - RECENT_WINDOW_MS;

    return insights
      .filter(
        (insight) =>
          !placed.has(insight.id) &&
          latestViewByQuestion.has(insight.id) &&
          touchedAt(insight) >= cutoff,
      )
      .sort((a, b) => touchedAt(b) - touchedAt(a))
      .slice(0, MAX_START_QUESTIONS)
      .map((insight) => {
        const table = resolveInsightSourceDataTable(
          insight,
          dataTables ?? [],
          insights,
        );
        return {
          insight,
          viewId: latestViewByQuestion.get(insight.id)!.id,
          tableName: table?.name,
          sourceType: dataSources?.find(
            (source) => source.id === table?.dataSourceId,
          )?.type,
        };
      });
  }, [dashboards, visualizations, insights, dataTables, dataSources, openedAt]);

  return {
    // Cards name their table, so wait for tables too or they flash "Unknown".
    isLoading:
      insightsQuery.isLoading ||
      tablesQuery.isLoading ||
      sourcesQuery.isLoading,
    candidates,
    // Unknown is not zero: a failed load must not claim there is no data.
    hasNoDataSources: !sourcesQuery.isError && dataSources?.length === 0,
    // A failed question load is not an empty candidate list either.
    questionsLoadError: insightsQuery.isError,
  };
}

/**
 * The empty reports list. A recent question that is not on a report yet is the
 * likeliest first tile, so those come first; otherwise one action creates the
 * report and the first chart is added from inside it.
 */
function ReportsStart({
  dashboards,
  visualizations,
  isCreating,
  onCreate,
}: {
  dashboards: readonly Dashboard[];
  visualizations: readonly Visualization[];
  isCreating: boolean;
  onCreate: CreateReport;
}) {
  const { isLoading, candidates, hasNoDataSources, questionsLoadError } =
    useUnplacedRecentQuestions(dashboards, visualizations);

  if (isLoading) return null;

  if (candidates.length === 0) {
    return (
      <ArtifactEmptyState
        title="No reports yet"
        description="A report is a page of charts and tables over your data. Create one and add the first chart from inside it."
        action={
          <div className="flex flex-col items-center gap-3">
            {/* Creating a report needs no question, so the action stays; the
                notice says why no recent question is offered. */}
            {questionsLoadError && (
              <p role="alert" className="text-sm text-palette-danger">
                Couldn't load your recent questions. Check your connection and
                reload.
              </p>
            )}
            <Button
              icon={PlusIcon}
              label="Create your first report"
              loading={isCreating}
              onClick={() => onCreate(UNTITLED_REPORT)}
            />
            {hasNoDataSources && (
              <Link
                to="/data-sources"
                className="text-sm text-neutral-fg-subtle underline-offset-4 transition-colors hover:text-neutral-fg hover:underline motion-reduce:transition-none"
              >
                or connect data first
              </Link>
            )}
          </div>
        }
      />
    );
  }

  return (
    <section aria-labelledby="reports-start-title" className="space-y-4">
      <div>
        <h2 id="reports-start-title" className="text-lg font-semibold">
          No reports yet
        </h2>
        <p className="mt-1 text-sm text-neutral-fg-subtle">
          Start one from a recent question, or from a blank page.
        </p>
      </div>
      <ArtifactGrid>
        {candidates.map(({ insight, viewId, tableName, sourceType }) => (
          <ArtifactCard
            key={insight.id}
            name={insight.name}
            headingLevel={3}
            icon={<FileIcon className="h-5 w-5" />}
            metadata={
              <>
                {tableName || "Unknown table"}
                {sourceType && (
                  <>
                    <span aria-hidden="true"> · </span> {sourceType}
                  </>
                )}
              </>
            }
            footer={
              <Button
                size="sm"
                variant="outline"
                label="Start report"
                disabled={isCreating}
                onClick={() => onCreate(UNTITLED_REPORT, viewId)}
              />
            }
          />
        ))}
        {/* Dashed: an unset report, the house mark for "choose". */}
        <button
          type="button"
          disabled={isCreating}
          onClick={() => onCreate(UNTITLED_REPORT)}
          className="flex min-h-30 items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-border p-4 text-sm text-neutral-fg-subtle transition-colors hover:bg-neutral-bg-subtle hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-bg focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
        >
          <PlusIcon aria-hidden className="h-4 w-4" />
          Blank report
        </button>
      </ArtifactGrid>
    </section>
  );
}

function ReportsCollectionContent({
  hasLoadError,
  isEmpty,
  searchQuery,
  onClearSearch,
  emptyState,
  children,
}: {
  hasLoadError: boolean;
  isEmpty: boolean;
  searchQuery: string;
  onClearSearch: () => void;
  emptyState: ReactNode;
  children: ReactNode;
}) {
  if (hasLoadError) {
    return (
      <ArtifactEmptyState
        title="Couldn't load reports"
        description="Something went wrong. Check your connection and try again."
      />
    );
  }

  if (!isEmpty) return children;

  if (searchQuery) {
    return (
      <ArtifactEmptyState
        title="No reports found"
        description={`No reports match "${searchQuery}"`}
        action={
          <Button
            variant="outline"
            label="Clear search"
            onClick={onClearSearch}
          />
        }
      />
    );
  }

  return emptyState;
}

export default function DashboardsPage() {
  const navigate = useNavigate();
  const {
    data: dashboards = [],
    isLoading: dashboardsLoading,
    isError: dashboardsLoadError,
  } = queryStatus(useQuery({ query: api.app.listDashboards, args: {} }));
  const {
    data: visualizations = [],
    isLoading: visualizationsLoading,
    isError: visualizationsLoadError,
  } = queryStatus(useQuery({ query: api.app.listVisualizations, args: {} }));
  const commitBatch = useMutation(api.app.commitBatch);
  const { showError } = useToastStore();
  const { confirm } = useConfirmDialogStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const handleDelete = (id: string, name: string) => {
    confirm({
      title: "Delete report",
      description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await commitBatch({
            commands: [cmd("DeleteNode", { id: id as UUID })],
          });
        } catch {
          showError("Failed to delete report. Please try again.");
        }
      },
    });
  };

  /** Create a report, optionally with a saved view as its first tile, and open it. */
  const createReport: CreateReport = async (name, firstVisualizationId) => {
    const id = crypto.randomUUID() as UUID;
    setIsCreating(true);
    try {
      await commitBatch({
        commands: [
          cmd("CreateDashboard", { id, name }),
          ...(firstVisualizationId
            ? [
                cmd("AddDashboardItem", {
                  dashboardId: id,
                  item: {
                    id: crypto.randomUUID() as UUID,
                    type: "visualization",
                    visualizationId: firstVisualizationId,
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 6,
                  },
                }),
              ]
            : []),
        ],
      });
    } catch {
      showError("Failed to create report. Please try again.");
      return false;
    } finally {
      setIsCreating(false);
    }

    navigate({ to: `/dashboards/${id}` } as never);
    return true;
  };

  // The report page has no inline rename yet, so the header keeps asking for
  // a name; the empty state creates "Untitled report" directly.
  const handleCreateNamed = async () => {
    if (!newDashboardName.trim()) return;
    if (!(await createReport(newDashboardName))) return;
    setIsCreateOpen(false);
    setNewDashboardName("");
  };

  const filteredDashboards = searchQuery.trim()
    ? dashboards.filter((dashboard) =>
        dashboard.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : dashboards;
  const reportContentIndexes = useMemo(
    () => indexReportContents(visualizations),
    [visualizations],
  );
  const hasLoadError = dashboardsLoadError || visualizationsLoadError;

  if (dashboardsLoading || visualizationsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading reports...</p>
      </div>
    );
  }

  return (
    <ArtifactCollection
      title="Reports"
      description={
        hasLoadError ? undefined : (
          <>
            {dashboards.length} report{dashboards.length !== 1 ? "s" : ""}
          </>
        )
      }
      actions={
        <Button
          icon={PlusIcon}
          label="New report"
          onClick={() => setIsCreateOpen(true)}
        />
      }
      searchLabel="Search reports"
      searchPlaceholder="Search reports..."
      itemCount={hasLoadError ? undefined : dashboards.length}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      <ReportsCollectionContent
        hasLoadError={hasLoadError}
        isEmpty={filteredDashboards.length === 0}
        searchQuery={searchQuery}
        onClearSearch={() => setSearchQuery("")}
        emptyState={
          <ReportsStart
            dashboards={dashboards}
            visualizations={visualizations}
            isCreating={isCreating}
            onCreate={createReport}
          />
        }
      >
        <ArtifactGrid>
          {filteredDashboards.map((dashboard) => {
            const contents = resolveReportContents(
              dashboard,
              reportContentIndexes,
            );
            return (
              <ArtifactCard
                key={dashboard.id}
                to={`/dashboards/${dashboard.id}`}
                icon={<DashboardIcon className="h-5 w-5" />}
                name={dashboard.name}
                metadata={
                  <>
                    {contents.questionIds.length} question
                    {contents.questionIds.length !== 1 ? "s" : ""}
                    <span aria-hidden="true"> · </span>
                    {contents.savedViews.length} saved view
                    {contents.savedViews.length !== 1 ? "s" : ""}
                  </>
                }
                actions={
                  <DropdownMenu>
                    <RoutedCardActionMenuTrigger />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate({
                            to: `/dashboards/${dashboard.id}`,
                          } as never);
                        }}
                      >
                        <ExternalLinkIcon className="mr-2 h-4 w-4" />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-palette-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete(dashboard.id, dashboard.name);
                        }}
                      >
                        <DeleteIcon className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          })}
        </ArtifactGrid>
      </ReportsCollectionContent>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create report</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="name" className="mb-2 block">
              Report name
            </Label>
            <Input
              id="name"
              value={newDashboardName}
              onChange={(e) => setNewDashboardName(e.target.value)}
              placeholder="e.g., Sales overview"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateNamed();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              label="Cancel"
              onClick={() => setIsCreateOpen(false)}
            />
            <Button
              label="Create"
              onClick={handleCreateNamed}
              disabled={!newDashboardName.trim() || isCreating}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ArtifactCollection>
  );
}
