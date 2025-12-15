"use client";

import { useState, useEffect, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@dashframe/ui";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Edit3,
  FileText,
  Plus,
} from "@dashframe/ui/icons";
import {
  useDashboards,
  useDashboardMutations,
  useVisualizations,
} from "@dashframe/core";
import type { DashboardItemType } from "@dashframe/types";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";

export default function DashboardDetailPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = use(params);
  const router = useRouter();

  // Dexie hooks
  const { data: dashboards = [], isLoading } = useDashboards();
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

  // Redirect if not found after loading completes
  useEffect(() => {
    if (!isLoading && !dashboard) {
      router.push("/dashboards");
    }
  }, [isLoading, dashboard, router]);

  // Show loading state until we have the dashboard
  if (isLoading || !dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading dashboard...</p>
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
      <div className="border-border/60 flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/dashboards")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {dashboard.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {dashboard.items.length} items
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditable ? (
            <Button onClick={() => setIsEditable(false)}>
              <Check className="mr-2 h-4 w-4" />
              Done Editing
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setIsEditable(true)}>
              <Edit3 className="mr-2 h-4 w-4" />
              Edit Dashboard
            </Button>
          )}
          {isEditable && (
            <Button variant="secondary" onClick={() => setIsAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Widget
            </Button>
          )}
        </div>
      </div>

      {/* Grid Content */}
      <div className="bg-muted/10 flex-1 overflow-y-auto p-6">
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
                      ? "border-primary bg-primary/5 ring-primary ring-1"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setAddType("visualization")}
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <BarChart3 className="h-4 w-4" />
                    Visualization
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Add an existing chart or table
                  </p>
                </div>
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    addType === "markdown"
                      ? "border-primary bg-primary/5 ring-primary ring-1"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setAddType("markdown")}
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <FileText className="h-4 w-4" />
                    Text / Markdown
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Add rich text, notes, or headers
                  </p>
                </div>
              </div>
            </div>

            {addType === "visualization" && (
              <div className="space-y-2">
                <Label>Select Visualization</Label>
                <Select value={selectedVizId} onValueChange={setSelectedVizId}>
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
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddItem}
              disabled={addType === "visualization" && !selectedVizId}
            >
              Add Widget
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
