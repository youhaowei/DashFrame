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
import { api } from "@dashframe/convex-backend/api";
import { cmd, type UUID } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
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
} from "@wystack/ui-react";
import {
  DashboardIcon,
  DeleteIcon,
  ExternalLinkIcon,
  PlusIcon,
  SparklesIcon,
} from "@wystack/ui-react/icons";
import { Input } from "@wystack/ui-react";
import { type ReactNode, useMemo, useState } from "react";

function ReportsCollectionContent({
  hasLoadError,
  isEmpty,
  searchQuery,
  onClearSearch,
  onCreateReport,
  children,
}: {
  hasLoadError: boolean;
  isEmpty: boolean;
  searchQuery: string;
  onClearSearch: () => void;
  onCreateReport: () => void;
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

  return (
    <ArtifactEmptyState
      title="No reports yet"
      description="Create your first report to organize questions and saved views."
      action={
        <Button
          icon={PlusIcon}
          label="Create report"
          onClick={onCreateReport}
        />
      }
    />
  );
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
  const {
    data: insights = [],
    isLoading: insightsLoading,
    isError: insightsLoadError,
  } = queryStatus(useQuery({ query: api.app.listInsights, args: {} }));
  const commitBatch = useMutation(api.app.commitBatch);
  const { showError } = useToastStore();
  const { confirm } = useConfirmDialogStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
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

  const handleCreate = async () => {
    if (!newDashboardName.trim()) return;

    const id = crypto.randomUUID() as UUID;
    try {
      await commitBatch({
        commands: [cmd("CreateDashboard", { id, name: newDashboardName })],
      });
    } catch {
      showError("Failed to create report. Please try again.");
      return;
    }

    setIsCreateOpen(false);
    setNewDashboardName("");
    navigate({ to: `/dashboards/${id}` } as never);
  };

  const filteredDashboards = searchQuery.trim()
    ? dashboards.filter((dashboard) =>
        dashboard.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : dashboards;
  const reportContentIndexes = useMemo(
    () => indexReportContents(visualizations, insights),
    [insights, visualizations],
  );
  const hasLoadError =
    dashboardsLoadError || visualizationsLoadError || insightsLoadError;

  if (dashboardsLoading || visualizationsLoading || insightsLoading) {
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
        <>
          <Button
            variant="outline"
            icon={SparklesIcon}
            label="Questions"
            onClick={() => navigate({ to: "/insights" })}
          />
          <Button
            icon={PlusIcon}
            label="New report"
            onClick={() => setIsCreateOpen(true)}
          />
        </>
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
        onCreateReport={() => setIsCreateOpen(true)}
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
                    {contents.questions.length} question
                    {contents.questions.length !== 1 ? "s" : ""}
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
                if (e.key === "Enter") handleCreate();
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
              onClick={handleCreate}
              disabled={!newDashboardName.trim()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ArtifactCollection>
  );
}
