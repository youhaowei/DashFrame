import { useBindArtifact } from "@/components/assistant/artifact-context";
import { DashboardControlBar } from "@/components/dashboards/DashboardControlBar";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { api } from "@/wystack/api";
import type { DashboardItemType, InsightFilter } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@wystack/client";
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
} from "@wystack/ui-react";
import {
  ArrowLeftIcon,
  ChartIcon,
  CheckIcon,
  EditIcon,
  FileIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface DashboardDetailContentProps {
  dashboardId: string;
}

export default function DashboardDetailContent({
  dashboardId,
}: DashboardDetailContentProps) {
  const navigate = useNavigate();

  const {
    data: dashboards = [],
    isLoading,
    isFetching,
  } = useQuery(api.listDashboards);
  const { data: visualizations = [] } = useQuery(api.listVisualizations, {
    args: {},
  });
  const { data: insights = [] } = useQuery(api.listInsights, { args: {} });
  const { data: dataTables = [] } = useQuery(api.listDataTables, { args: {} });
  const addItem = useMutation(api.addDashboardItem);

  // Find the dashboard
  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId),
    [dashboards, dashboardId],
  );

  // Bind the assistant to this dashboard (cleared on unmount).
  useBindArtifact(
    useMemo(
      () =>
        dashboard
          ? {
              kind: "dashboard" as const,
              id: dashboardId,
              title: dashboard.name || "Untitled dashboard",
            }
          : null,
      [dashboard, dashboardId],
    ),
  );

  // ── Controls ─────────────────────────────────────────────────────────────
  // View-local transient values for dashboard controls.  A viewer (or author)
  // turning a control writes here, NOT back to the saved dashboard.  This is
  // the ephemeral overlay described in the spec; the full promote-to-saved UX
  // is deferred to a later ticket.  Reset when the dashboard changes.
  const [controlTransientValues, setControlTransientValues] = useState<
    Map<string, InsightFilter["value"]>
  >(new Map());

  // Build fieldsByName map from all data tables referenced by the dashboard's
  // visualizations/insights.  Used by DashboardControlBar to detect field type
  // so the correct input (text/number/date) is rendered per control.
  const fieldsByName = useMemo<Map<string, CombinedField>>(() => {
    const map = new Map<string, CombinedField>();
    if (!dashboard) return map;

    // Collect the base table ids referenced by the dashboard's items.
    const vizIds = new Set(
      dashboard.items
        .filter((i) => i.type === "visualization")
        .map((i) => i.visualizationId)
        .filter(Boolean),
    );
    const insightIds = new Set(
      visualizations.filter((v) => vizIds.has(v.id)).map((v) => v.insightId),
    );
    const tableIds = new Set(
      insights.filter((i) => insightIds.has(i.id)).map((i) => i.baseTableId),
    );

    for (const tableId of tableIds) {
      const table = dataTables.find((t) => t.id === tableId);
      if (!table) continue;
      for (const field of table.fields ?? []) {
        const key = field.columnName ?? field.name;
        if (!map.has(key)) {
          // Cast to CombinedField — no display-name dedup needed here since we
          // only use it for type detection in the control bar.
          map.set(key, {
            ...field,
            sourceTableId: table.id,
            displayName: field.name,
          });
        }
      }
    }
    return map;
  }, [dashboard, visualizations, insights, dataTables]);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [isEditable, setIsEditable] = useState(false);
  // DashboardGrid reports availability only after its first width measurement.
  const [isEditingAvailable, setIsEditingAvailable] = useState<boolean | null>(
    null,
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddPending, setIsAddPending] = useState(false);
  const [addType, setAddType] = useState<DashboardItemType>("visualization");
  const [selectedVizId, setSelectedVizId] = useState<string>("");
  const editingSessionKey =
    isLoading || isFetching || !dashboard ? null : dashboardId;
  const [activeEditingSessionKey, setActiveEditingSessionKey] =
    useState(editingSessionKey);
  if (activeEditingSessionKey !== editingSessionKey) {
    setActiveEditingSessionKey(editingSessionKey);
    setIsEditingAvailable(null);
    setIsEditable(false);
    setIsAddOpen(false);
  }

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

  const handleEditingAvailabilityChange = useCallback(
    (isAvailable: boolean) => {
      setIsEditingAvailable(isAvailable);
      if (!isAvailable) {
        setIsEditable(false);
        setIsAddOpen(false);
      }
    },
    [],
  );

  // Show loading state until we have the dashboard (or any fetch is in progress)
  if (isLoading || isFetching || !dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading dashboard...</p>
      </div>
    );
  }

  const handleAddItem = async () => {
    if (!isEditingAvailable) {
      setIsAddOpen(false);
      return;
    }

    // Compute the bottom of the current layout so the new widget is appended
    // below all existing items. Using Infinity here would serialize to null in
    // JSON and cause the server-side position validator to reject the mutation.
    const bottomY = dashboard.items.reduce(
      (max, item) => Math.max(max, item.y + item.height),
      0,
    );

    setIsAddPending(true);
    try {
      await addItem.mutateAsync({
        dashboardId,
        type: addType,
        position: {
          x: 0,
          y: bottomY,
          width: addType === "visualization" ? 6 : 4,
          height: addType === "visualization" ? 6 : 4,
        },
        visualizationId:
          addType === "visualization" ? selectedVizId : undefined,
        content:
          addType === "markdown"
            ? "## New Text Widget\n\nEdit this text..."
            : undefined,
      });
    } catch (error) {
      // Keep the dialog open so the user's selection isn't lost.
      console.error("Failed to add dashboard widget", error);
      toast.error("Couldn't add widget");
      return;
    } finally {
      setIsAddPending(false);
    }

    setIsAddOpen(false);
    setAddType("visualization");
    setSelectedVizId("");
  };

  return (
    <div
      className="dashboard-detail flex h-full flex-col"
      data-editing-available={isEditingAvailable}
    >
      {/* Header */}
      <div className="dashboard-detail-header flex min-w-0 flex-wrap items-start justify-between gap-4 border-b border-neutral-border/60 px-6 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Button
            variant="ghost"
            icon={ArrowLeftIcon}
            iconOnly
            label="Back to dashboards"
            onClick={() => navigate({ to: "/dashboards" })}
          />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold tracking-tight text-neutral-fg [overflow-wrap:anywhere]">
              {dashboard.name}
            </h1>
            <p className="text-sm text-neutral-fg-subtle">
              {dashboard.items.length} items
            </p>
          </div>
        </div>
        <div className="dashboard-edit-controls flex max-w-full shrink-0 flex-col items-end gap-1">
          <div className="dashboard-edit-actions flex items-center gap-2">
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
                disabled={isEditingAvailable !== true}
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
          {isEditingAvailable === false && (
            <p className="dashboard-editing-unavailable text-xs text-neutral-fg-subtle">
              Editing unavailable: dashboard needs a wider area.
            </p>
          )}
        </div>
      </div>

      {/* Control Bar — only rendered when the dashboard has controls */}
      {(dashboard.controls ?? []).length > 0 && (
        <DashboardControlBar
          controls={dashboard.controls!}
          fieldsByName={fieldsByName}
          transientValues={controlTransientValues}
          onTransientChange={setControlTransientValues}
        />
      )}

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto bg-neutral-bg-muted/10 p-6">
        <DashboardGrid
          dashboard={dashboard}
          isEditable={isEditable}
          onEditingAvailabilityChange={handleEditingAvailabilityChange}
          controlTransientValues={controlTransientValues}
        />
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
              disabled={
                !isEditingAvailable ||
                isAddPending ||
                (addType === "visualization" && !selectedVizId)
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
