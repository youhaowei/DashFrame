"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Input,
  Surface,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Label,
  PlusIcon,
  DashboardIcon,
  DeleteIcon,
} from "@dashframe/ui";
import { useDashboards, useDashboardMutations } from "@dashframe/core";

export default function DashboardsPage() {
  const router = useRouter();
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
    router.push(`/dashboards/${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading dashboards...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <DashboardIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Dashboards
            </h1>
            <p className="text-sm text-muted-foreground">
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
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <DashboardIcon className="h-10 w-10" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              No dashboards yet
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
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
                href={`/dashboards/${dashboard.id}`}
                className="group block h-full"
              >
                <Surface
                  elevation="raised"
                  className="relative flex h-full flex-col p-5 transition-all hover:border-primary/50 hover:shadow-md"
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <DashboardIcon className="h-5 w-5" />
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                    >
                      <Button
                        variant="text"
                        icon={DeleteIcon}
                        iconOnly
                        label="Delete dashboard"
                        color="danger"
                        className="-mt-2 -mr-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                        onClick={() => removeDashboard(dashboard.id)}
                      />
                    </div>
                  </div>
                  <h3 className="mb-1 font-semibold text-foreground">
                    {dashboard.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
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
              variant="outlined"
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
