import { useDashboardMutations, useDashboards } from "@dashframe/core";
import { DashboardIcon, DeleteIcon, PlusIcon } from "@stdui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Surface,
} from "@stdui/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export default function DashboardsPage() {
  const navigate = useNavigate();
  const { data: dashboards = [], isLoading } = useDashboards();
  const { create: createDashboard, remove: removeDashboard } =
    useDashboardMutations();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");

  const handleCreate = async () => {
    if (!newDashboardName.trim()) return;

    const id = await createDashboard(newDashboardName);

    setIsCreateOpen(false);
    setNewDashboardName("");
    navigate({ to: `/dashboards/${id}` } as never);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading dashboards...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-border/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-palette-primary/10 text-palette-primary">
            <DashboardIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-fg">
              Dashboards
            </h1>
            <p className="text-sm text-neutral-fg-subtle">
              Manage your dashboards and reports
            </p>
          </div>
        </div>
        <Button
          icon={PlusIcon}
          label="New Dashboard"
          onClick={() => setIsCreateOpen(true)}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {dashboards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-neutral-bg-muted text-neutral-fg-subtle">
              <DashboardIcon className="h-10 w-10" />
            </div>
            <h3 className="text-lg font-semibold text-neutral-fg">
              No dashboards yet
            </h3>
            <p className="mt-2 max-w-sm text-sm text-neutral-fg-subtle">
              Create your first dashboard to start organizing your
              visualizations.
            </p>
            <Button
              icon={PlusIcon}
              label="Create Dashboard"
              className="mt-6"
              onClick={() => setIsCreateOpen(true)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {dashboards.map((dashboard) => (
              <Link
                key={dashboard.id}
                to={`/dashboards/${dashboard.id}` as never}
                className="group block h-full"
              >
                <Surface
                  elevation="raised"
                  className="relative flex h-full flex-col p-5 transition-all hover:border-palette-primary/50 hover:shadow-md"
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-palette-primary/10 text-palette-primary">
                      <DashboardIcon className="h-5 w-5" />
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                    >
                      <Button
                        variant="ghost"
                        icon={DeleteIcon}
                        iconOnly
                        label="Delete dashboard"
                        color="danger"
                        className="-mt-2 -mr-2 text-neutral-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-palette-danger"
                        onClick={() => removeDashboard(dashboard.id)}
                      />
                    </div>
                  </div>
                  <h3 className="mb-1 font-semibold text-neutral-fg">
                    {dashboard.name}
                  </h3>
                  <p className="text-sm text-neutral-fg-subtle">
                    {dashboard.items.length} items · Updated{" "}
                    {dashboard.updatedAt
                      ? new Date(dashboard.updatedAt).toLocaleDateString()
                      : new Date(dashboard.createdAt).toLocaleDateString()}
                  </p>
                </Surface>
              </Link>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
