import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import {
  useDashboardMutations,
  useDashboards,
  useVisualizations,
} from "@dashframe/core";
import type { DashboardItemType } from "@dashframe/types";
import {
  ArrowLeftIcon,
  ChartIcon,
  CheckIcon,
  EditIcon,
  FileIcon,
  PlusIcon,
} from "@stdui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@stdui/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

interface DashboardDetailContentProps {
  dashboardId: string;
}

export default function DashboardDetailContent({
  dashboardId,
}: DashboardDetailContentProps) {
  const navigate = useNavigate();

  // Dexie hooks
  const {
    data: dashboards = [],
    isLoading,
    isFetching = false,
  } = useDashboards();
  const { data: visualizations = [] } = useVisualizations();
  const { addItem } = useDashboardMutations();

  // Find the dashboard
  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId),
    [dashboards, dashboardId],
  );

  // Local state
  const [isEditable, setIsEditable] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addType, setAddType] = useState<DashboardItemType>("visualization");
  const [selectedVizId, setSelectedVizId] = useState<string>("");

  // Redirect if not found — but only once any in-flight fetch has settled.
  // Guard on isFetching as well as isLoading: TanStack Query sets isLoading=false
  // when stale cached data exists even while a background refetch runs.  Without
  // the isFetching guard, navigating to /dashboards/<id> right after creation
  // sees stale cache → isLoading=false, dashboard=undefined → instant redirect
  // before the mutation invalidation re-fetch completes.
  useEffect(() => {
    if (!isLoading && !isFetching && !dashboard) {
      navigate({ to: "/dashboards" });
    }
  }, [isLoading, isFetching, dashboard, navigate]);

  // Show loading state until we have the dashboard (or any fetch is in progress)
  if (isLoading || isFetching || !dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading dashboard...</p>
      </div>
    );
  }

  const handleAddItem = async () => {
    await addItem(dashboardId, {
      type: addType,
      position: {
        x: 0,
        y: Infinity, // Put at bottom
        width: addType === "visualization" ? 6 : 4,
        height: addType === "visualization" ? 6 : 4,
      },
      visualizationId: addType === "visualization" ? selectedVizId : undefined,
      content:
        addType === "markdown"
          ? "## New Text Widget\n\nEdit this text..."
          : undefined,
    });

    setIsAddOpen(false);
    setAddType("visualization");
    setSelectedVizId("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-border/60 px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            icon={ArrowLeftIcon}
            iconOnly
            label="Back to dashboards"
            onClick={() => navigate({ to: "/dashboards" })}
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-fg">
              {dashboard.name}
            </h1>
            <p className="text-sm text-neutral-fg-subtle">
              {dashboard.items.length} items
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditable ? (
            <Button
              icon={CheckIcon}
              label="Done Editing"
              onClick={() => setIsEditable(false)}
            />
          ) : (
            <Button
              variant="outline"
              icon={EditIcon}
              label="Edit Dashboard"
              onClick={() => setIsEditable(true)}
            />
          )}
          {isEditable && (
            <Button
              color="secondary"
              icon={PlusIcon}
              label="Add Widget"
              onClick={() => setIsAddOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto bg-neutral-bg-muted/10 p-6">
        <DashboardGrid dashboard={dashboard} isEditable={isEditable} />
      </div>

      {/* Add Widget Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Widget</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Widget Type</Label>
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    addType === "visualization"
                      ? "border-palette-primary bg-palette-primary/5 ring-1 ring-palette-primary"
                      : "hover:border-palette-primary/50"
                  }`}
                  onClick={() => setAddType("visualization")}
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <ChartIcon className="h-4 w-4" />
                    Visualization
                  </div>
                  <p className="text-xs text-neutral-fg-subtle">
                    Add an existing chart or table
                  </p>
                </div>
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    addType === "markdown"
                      ? "border-palette-primary bg-palette-primary/5 ring-1 ring-palette-primary"
                      : "hover:border-palette-primary/50"
                  }`}
                  onClick={() => setAddType("markdown")}
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <FileIcon className="h-4 w-4" />
                    Text / Markdown
                  </div>
                  <p className="text-xs text-neutral-fg-subtle">
                    Add rich text, notes, or headers
                  </p>
                </div>
              </div>
            </div>

            {addType === "visualization" && (
              <div className="space-y-2">
                <Label>Select Visualization</Label>
                <Select
                  value={selectedVizId}
                  onValueChange={(v) => setSelectedVizId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a visualization..." />
                  </SelectTrigger>
                  <SelectContent>
                    {visualizations.map((viz) => (
                      <SelectItem key={viz.id} value={viz.id}>
                        {viz.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              label="Cancel"
              onClick={() => setIsAddOpen(false)}
            />
            <Button
              label="Add Widget"
              onClick={handleAddItem}
              disabled={addType === "visualization" && !selectedVizId}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
