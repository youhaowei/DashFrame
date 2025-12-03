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
  Plus,
  LayoutDashboard,
  Trash2,
} from "@dashframe/ui";
import { useDashboardsStore } from "@/lib/stores/dashboards-store";

import { useShallow } from "zustand/react/shallow";

export default function DashboardsPage() {
  const router = useRouter();
  const dashboards = useDashboardsStore(
    useShallow((state) => Array.from(state.dashboards.values())),
  );
  const addDashboard = useDashboardsStore((state) => state.addDashboard);
  const removeDashboard = useDashboardsStore((state) => state.removeDashboard);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");

  const handleCreate = () => {
    if (!newDashboardName.trim()) return;

    const id = crypto.randomUUID();
    addDashboard({
      id,
      name: newDashboardName,
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    setIsCreateOpen(false);
    setNewDashboardName("");
    router.push(`/dashboards/${id}`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-border/60 flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              Dashboards
            </h1>
            <p className="text-muted-foreground text-sm">
              Manage your dashboards and reports
            </p>
          </div>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Dashboard
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {dashboards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="bg-muted text-muted-foreground mb-4 flex h-20 w-20 items-center justify-center rounded-full">
              <LayoutDashboard className="h-10 w-10" />
            </div>
            <h3 className="text-foreground text-lg font-semibold">
              No dashboards yet
            </h3>
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Create your first dashboard to start organizing your visualizations.
            </p>
            <Button className="mt-6" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Dashboard
            </Button>
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
                    <div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-lg">
                      <LayoutDashboard className="h-5 w-5" />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive -mr-2 -mt-2 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeDashboard(dashboard.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <h3 className="text-foreground mb-1 font-semibold">
                    {dashboard.name}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {dashboard.items.length} items · Updated{" "}
                    {new Date(dashboard.updatedAt).toLocaleDateString()}
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
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newDashboardName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
