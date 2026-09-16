import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import { ArtifactEmptyState } from "@/components/artifacts/ArtifactCollection";
import { ArtifactPageHeader } from "@/components/artifacts/ArtifactPageHeader";
import { queryStatus } from "@/data/query-status";
import { Breadcrumb } from "@dashframe/ui";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { useBindArtifact } from "@/components/assistant/artifact-context";
import { DashboardControlBar } from "@/components/dashboards/DashboardControlBar";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import type { VisualizationTileState } from "@/components/visualizations/VisualizationDisplay";
import { mergeTransientItemOverrides } from "@/lib/dashboards/controls";
import {
  resolveInsightAvailableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import {
  indexReportContents,
  resolveReportContents,
} from "@/lib/reports/report-contents";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type DashboardItemOverrides,
  type DashboardItemType,
  type InsightFilter,
  type UUID,
} from "@dashframe/types";
import { Link, useNavigate } from "@tanstack/react-router";
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

const EMPTY_OVERRIDES: Map<UUID, DashboardItemOverrides> = new Map();
const EMPTY_TILES: Map<UUID, VisualizationTileState> = new Map();

/**
 * The one report-level line about tile health. It appears only when a tile
 * cannot be shown at all; a tile showing earlier data says so on its own foot.
 * It never asserts a report-wide freshness. A reader gets the count; the
 * author also gets which tiles.
 */
export function formatBrokenTilesLine(
  brokenNames: readonly string[],
  audience: "author" | "reader",
): string | null {
  if (brokenNames.length === 0) return null;
  const count = brokenNames.length;
  const line = `${count} chart${count === 1 ? "" : "s"} can't be shown right now`;
  return audience === "author" ? `${line}: ${brokenNames.join(", ")}` : line;
}

export function formatReportContentsCount(
  questionCount: number,
  savedViewCount: number,
): string {
  return `${questionCount} question${questionCount === 1 ? "" : "s"} · ${savedViewCount} saved view${savedViewCount === 1 ? "" : "s"}`;
}

export default function DashboardDetailContent({
  dashboardId,
}: DashboardDetailContentProps) {
  const navigate = useNavigate();

  const {
    data: dashboards = [],
    isLoading,
    isFetching,
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
  const { data: dataTables = [] } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const commitBatch = useMutation(api.app.commitBatch);

  // Find the dashboard
  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId),
    [dashboards, dashboardId],
  );
  const reportContents = useMemo(
    () =>
      dashboard
        ? resolveReportContents(dashboard, indexReportContents(visualizations))
        : { savedViews: [], questionIds: [] },
    [dashboard, visualizations],
  );
  const questionMetadataAvailable = !insightsLoading && !insightsLoadError;

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
  // A reader's changes through a tile's own knobs, per item. Same rule as the
  // control bar: view-local, never written back. Tagged with the dashboard id
  // so navigating to another report starts clean without an effect.
  const [readerState, setReaderState] = useState<{
    dashboardId: string;
    overrides: Map<UUID, DashboardItemOverrides>;
    tiles: Map<UUID, VisualizationTileState>;
  }>(() => ({ dashboardId, overrides: new Map(), tiles: new Map() }));
  const itemTransientOverrides =
    readerState.dashboardId === dashboardId
      ? readerState.overrides
      : EMPTY_OVERRIDES;
  const tileStates =
    readerState.dashboardId === dashboardId ? readerState.tiles : EMPTY_TILES;
  const handleReaderChange = useCallback(
    (itemId: UUID, patch: DashboardItemOverrides) => {
      setReaderState((current) => {
        const same = current.dashboardId === dashboardId;
        const overrides = new Map(same ? current.overrides : undefined);
        overrides.set(
          itemId,
          mergeTransientItemOverrides(overrides.get(itemId), patch) ?? {},
        );
        return {
          dashboardId,
          overrides,
          tiles: same ? current.tiles : new Map(),
        };
      });
    },
    [dashboardId],
  );
  const handleTileStateChange = useCallback(
    (itemId: UUID, state: VisualizationTileState) => {
      setReaderState((current) => {
        const same = current.dashboardId === dashboardId;
        if (same && current.tiles.get(itemId) === state) return current;
        const tiles = new Map(same ? current.tiles : undefined);
        tiles.set(itemId, state);
        return {
          dashboardId,
          overrides: same ? current.overrides : new Map(),
          tiles,
        };
      });
    },
    [dashboardId],
  );
  const setWebMCPDashboard = useWebMCPPageStore((state) => state.setDashboard);
  useEffect(() => {
    setWebMCPDashboard({
      dashboardId,
      transientControlValues: Object.fromEntries(controlTransientValues),
    });
    return () => setWebMCPDashboard(null);
  }, [controlTransientValues, dashboardId, setWebMCPDashboard]);

  // Build fieldsByName map from all data tables referenced by the dashboard's
  // visualizations/insights.  Used by DashboardControlBar to detect field type
  // so the correct input (text/number/date) is rendered per control.
  const fieldsByName = useMemo<Map<string, CombinedField>>(() => {
    const map = new Map<string, CombinedField>();
    if (!dashboard) return map;

    const vizIds = new Set(
      dashboard.items
        .filter((i) => i.type === "visualization")
        .map((i) => i.visualizationId)
        .filter(Boolean),
    );
    const insightIds = new Set(
      visualizations.filter((v) => vizIds.has(v.id)).map((v) => v.insightId),
    );
    for (const insight of insights.filter((candidate) =>
      insightIds.has(candidate.id),
    )) {
      const fields = resolveInsightAvailableFields(
        insight,
        dataTables,
        insights,
      );
      for (const field of fields) {
        const key = field.columnName ?? field.name;
        if (!map.has(key)) map.set(key, field);
      }
    }
    return map;
  }, [dashboard, visualizations, insights, dataTables]);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [isEditable, setIsEditable] = useState(false);
  const [isCreateQuestionOpen, setIsCreateQuestionOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddPending, setIsAddPending] = useState(false);
  const [addType, setAddType] = useState<DashboardItemType>("visualization");
  const [selectedVizId, setSelectedVizId] = useState<string>("");

  // Redirect if not found — but only once any in-flight fetch has settled.
  // Guard on isFetching as well as isLoading: TanStack Query sets isLoading=false
  // when stale cached data exists even while a background refetch runs.  Without
  // the isFetching guard, navigating to /dashboards/<id> right after creation
  // sees stale cache → isLoading=false, dashboard=undefined → instant redirect
  // before the mutation invalidation re-fetch completes.
  useEffect(() => {
    if (!isLoading && !isFetching && !dashboardsLoadError && !dashboard) {
      navigate({ to: "/dashboards" });
    }
  }, [isLoading, isFetching, dashboardsLoadError, dashboard, navigate]);

  if (dashboardsLoadError || visualizationsLoadError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-neutral-fg">
            Couldn&apos;t load report contents
          </h1>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            Something went wrong. Check your connection and try again.
          </p>
        </div>
      </div>
    );
  }

  // Show loading state until we have the dashboard (or any fetch is in progress)
  if (isLoading || isFetching || visualizationsLoading || !dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading report...</p>
      </div>
    );
  }

  const brokenTilesLine = formatBrokenTilesLine(
    dashboard.items
      .filter((item) => tileStates.get(item.id) === "broken")
      .map(
        (item) =>
          visualizations.find((viz) => viz.id === item.visualizationId)?.name ??
          "Untitled chart",
      ),
    isEditable ? "author" : "reader",
  );

  const handleAddItem = async () => {
    // Compute the bottom of the current layout so the new widget is appended
    // below all existing items. Using Infinity here would serialize to null in
    // JSON and cause the server-side position validator to reject the mutation.
    const bottomY = dashboard.items.reduce(
      (max, item) => Math.max(max, item.y + item.height),
      0,
    );

    setIsAddPending(true);
    try {
      await commitBatch({
        commands: [
          cmd("AddDashboardItem", {
            dashboardId: dashboardId as UUID,
            item: {
              id: crypto.randomUUID() as UUID,
              type: addType,
              x: 0,
              y: bottomY,
              width: addType === "visualization" ? 6 : 4,
              height: addType === "visualization" ? 6 : 4,
              visualizationId:
                addType === "visualization"
                  ? (selectedVizId as UUID)
                  : undefined,
              content:
                addType === "markdown"
                  ? "## New Text Widget\n\nEdit this text..."
                  : undefined,
            },
          }),
        ],
      });
    } catch (error) {
      // Keep the dialog open so the user's selection isn't lost.
      console.error("Failed to add report item", error);
      toast.error("Couldn't add report item");
      return;
    } finally {
      setIsAddPending(false);
    }

    setIsAddOpen(false);
    setAddType("visualization");
    setSelectedVizId("");
  };

  return (
    <div className="flex h-full flex-col">
      <ArtifactPageHeader
        title={dashboard.name}
        description={
          dashboard.items.length === 0
            ? "Nothing on it yet"
            : formatReportContentsCount(
                reportContents.questionIds.length,
                reportContents.savedViews.length,
              )
        }
        navigation={
          <Breadcrumb
            LinkComponent={Link}
            items={[
              { label: "Reports", to: "/dashboards" },
              { label: dashboard.name },
            ]}
          />
        }
        actions={
          <>
            {isEditable ? (
              <Button
                icon={CheckIcon}
                label="Done editing"
                onClick={() => setIsEditable(false)}
              />
            ) : (
              <Button
                variant="outline"
                icon={EditIcon}
                label="Edit report"
                onClick={() => setIsEditable(true)}
              />
            )}
            <Button
              color="secondary"
              icon={PlusIcon}
              label="Add item"
              onClick={() => setIsAddOpen(true)}
            />
          </>
        }
      />

      {/* Control Bar — only rendered when the dashboard has controls */}
      {questionMetadataAvailable && (dashboard.controls ?? []).length > 0 && (
        <DashboardControlBar
          controls={dashboard.controls!}
          fieldsByName={fieldsByName}
          transientValues={controlTransientValues}
          onTransientChange={setControlTransientValues}
        />
      )}

      {brokenTilesLine && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-neutral-border/60 bg-neutral-bg px-6 py-2 text-xs text-palette-danger"
        >
          {brokenTilesLine}
        </div>
      )}

      {/* The report is the grid. An empty report is one invitation, not a
          set of zero counts. */}
      <div className="flex-1 overflow-y-auto bg-neutral-bg-muted/10 p-6">
        {dashboard.items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <ArtifactEmptyState
              title="Put something on this report"
              description="Ask a question of your data and add the answer here, or add a view you already saved."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    label="Ask a question"
                    icon={PlusIcon}
                    onClick={() => setIsCreateQuestionOpen(true)}
                  />
                  <Button
                    variant="outline"
                    label="Add a saved view"
                    onClick={() => setIsAddOpen(true)}
                  />
                </div>
              }
            />
          </div>
        ) : (
          <DashboardGrid
            dashboard={dashboard}
            isEditable={isEditable}
            controlTransientValues={controlTransientValues}
            itemTransientOverrides={itemTransientOverrides}
            onReaderChange={handleReaderChange}
            onTileStateChange={handleTileStateChange}
          />
        )}
      </div>

      <CreateVisualizationModal
        isOpen={isCreateQuestionOpen}
        onClose={() => setIsCreateQuestionOpen(false)}
        title="Create question"
        reportId={dashboardId}
      />

      {/* Add Widget Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add report item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Item type</Label>
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
                    Saved view
                  </div>
                  <p className="text-xs text-neutral-fg-subtle">
                    Add an existing saved chart
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
                <Label>Select saved view</Label>
                <Select
                  value={selectedVizId}
                  onValueChange={(v) => setSelectedVizId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a saved view..." />
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
              label="Add item"
              onClick={handleAddItem}
              disabled={
                isAddPending || (addType === "visualization" && !selectedVizId)
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
