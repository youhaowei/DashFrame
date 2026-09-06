import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useConfirmDialogStore, useToastStore } from "@/lib/stores";
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
} from "@wystack/ui-react/icons";
import { Input } from "@wystack/ui-react";
import { useState } from "react";

export default function DashboardsPage() {
  const navigate = useNavigate();
  const { data: dashboards = [], isLoading } = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );
  const commitBatch = useMutation(api.app.commitBatch);
  const { showError } = useToastStore();
  const { confirm } = useConfirmDialogStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const handleDelete = (id: string, name: string) => {
    confirm({
      title: "Delete dashboard",
      description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await commitBatch({
            commands: [cmd("DeleteNode", { id: id as UUID })],
          });
        } catch {
          showError("Failed to delete dashboard. Please try again.");
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
      showError("Failed to create dashboard. Please try again.");
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading dashboards...</p>
      </div>
    );
  }

  return (
    <ArtifactCollection
      title="Dashboards"
      description={
        <>
          {dashboards.length} dashboard
          {dashboards.length !== 1 ? "s" : ""}
        </>
      }
      actions={
        <Button
          icon={PlusIcon}
          label="New Dashboard"
          onClick={() => setIsCreateOpen(true)}
        />
      }
      searchLabel="Search dashboards"
      searchPlaceholder="Search dashboards..."
      itemCount={dashboards.length}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      {filteredDashboards.length === 0 ? (
        <ArtifactEmptyState
          title={searchQuery ? "No dashboards found" : "No dashboards yet"}
          description={
            searchQuery
              ? `No dashboards match "${searchQuery}"`
              : "Create your first dashboard to start organizing your visualizations."
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
                label="Create Dashboard"
                onClick={() => setIsCreateOpen(true)}
              />
            )
          }
        />
      ) : (
        <ArtifactGrid>
          {filteredDashboards.map((dashboard) => (
            <ArtifactCard
              key={dashboard.id}
              to={`/dashboards/${dashboard.id}`}
              icon={<DashboardIcon className="h-5 w-5" />}
              name={dashboard.name}
              metadata={
                <>
                  {dashboard.items.length} item
                  {dashboard.items.length !== 1 ? "s" : ""}
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
          ))}
        </ArtifactGrid>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Dashboard</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="name" className="mb-2 block">
              Dashboard Name
            </Label>
            <Input
              id="name"
              value={newDashboardName}
              onChange={(e) => setNewDashboardName(e.target.value)}
              placeholder="e.g., Sales Overview"
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
