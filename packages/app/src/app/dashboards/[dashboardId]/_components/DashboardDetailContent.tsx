import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import { ArtifactPageHeader } from "@/components/artifacts/ArtifactPageHeader";
import { queryStatus } from "@/data/query-status";
import { Breadcrumb } from "@dashframe/ui";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { useBindArtifact } from "@/components/assistant/artifact-context";
import { DashboardControlBar } from "@/components/dashboards/DashboardControlBar";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import {
  ReaderWidthFrame,
  useReaderWidthScale,
} from "@/components/dashboards/ReaderWidthFrame";
import { ReportItemPane } from "@/components/dashboards/ReportItemPane";
import {
  useReportDraft,
  useReportWrite,
} from "@/components/dashboards/report-write";
import { draftLifecycleErrorDescription } from "@/components/preview-diff/user-facing-errors";
import {
  resolveInsightAvailableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type Dashboard,
  type DashboardItemType,
  type DataTable,
  type Insight,
  type Visualization,
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
  cn,
} from "@wystack/ui-react";
import {
  ChartIcon,
  CheckIcon,
  EditIcon,
  EyeIcon,
  FileIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface DashboardDetailContentProps {
  dashboardId: string;
  /**
   * `view` reads the published report. `edit` is the workbench: it reads the
   * report through `draftId` and must sit inside a `ReportDraftProvider`.
   */
  mode: "view" | "edit";
  draftId?: string;
}

export default function DashboardDetailContent({
  dashboardId,
  mode,
  draftId,
}: DashboardDetailContentProps) {
  const navigate = useNavigate();
  const isEditable = mode === "edit";
  // Preview shows the draft as a reader sees it: no pane, no editing chrome,
  // charts at full size. Editing shrinks the report beside its panes.
  const [isPreviewing, setIsPreviewing] = useState(false);
  const canArrange = isEditable && !isPreviewing;

  const {
    dashboard,
    isLoading,
    isError: dashboardsLoadError,
  } = useReportRead(dashboardId, draftId);
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
  const writeReport = useReportWrite();

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
  const fieldsByName = useMemo(
    () => reportFieldsByName(dashboard, visualizations, insights, dataTables),
    [dashboard, visualizations, insights, dataTables],
  );

  // ── Local UI state ────────────────────────────────────────────────────────
  const [isCreateQuestionOpen, setIsCreateQuestionOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddPending, setIsAddPending] = useState(false);
  const [addType, setAddType] = useState<DashboardItemType>("visualization");
  const [selectedVizId, setSelectedVizId] = useState<string>("");
  // The pane keeps rendering its last item while it closes, so the width
  // transition collapses real content instead of an empty column.
  const [paneItemId, setPaneItemId] = useState<string | null>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const {
    setCanvas,
    setPane,
    readerWidth,
    scale: canvasScale,
  } = useReaderWidthScale();

  const selectItem = (itemId: string) => {
    setPaneItemId(itemId);
    setIsPaneOpen(true);
  };
  const closePane = () => setIsPaneOpen(false);

  useEffect(() => {
    if (!isPaneOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPaneOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPaneOpen]);

  // Redirect if not found, once the read has settled.
  useEffect(() => {
    if (!isLoading && !dashboardsLoadError && !dashboard) {
      navigate({ to: "/dashboards" });
    }
  }, [isLoading, dashboardsLoadError, dashboard, navigate]);

  const { publish, discard } = useReportDraftActions({
    dashboardId,
    draftReadFailed: Boolean(draftId && dashboardsLoadError),
  });

  if ((dashboardsLoadError && !draftId) || visualizationsLoadError) {
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
  if (visualizationsLoading || !dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading report...</p>
      </div>
    );
  }

  const paneItem = dashboard.items.find((item) => item.id === paneItemId);
  const showPane = canArrange && isPaneOpen && paneItem !== undefined;

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
      await writeReport({
        commands: [
          cmd("AddDashboardItem", {
            dashboardId: dashboardId as UUID,
            item: newReportItem(addType, selectedVizId as UUID, bottomY),
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
          <ReportHeaderActions
            dashboardId={dashboardId}
            mode={mode}
            draftId={draftId}
            isPreviewing={isPreviewing}
            onTogglePreview={() => setIsPreviewing((previewing) => !previewing)}
            onAddItem={() => setIsAddOpen(true)}
            onPublish={publish}
            onDiscard={discard}
          />
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Control Bar — only rendered when the dashboard has controls */}
          {questionMetadataAvailable &&
            (dashboard.controls ?? []).length > 0 && (
              <DashboardControlBar
                controls={dashboard.controls!}
                fieldsByName={fieldsByName}
                transientValues={controlTransientValues}
                onTransientChange={setControlTransientValues}
              />
            )}

          {/* Grid Content — a click outside every item closes the pane. */}
          <div
            ref={setCanvas}
            className="flex-1 overflow-y-auto bg-neutral-bg-muted/10 p-6"
            onClick={(event) => {
              if (
                !(event.target as HTMLElement).closest(
                  "[data-dashframe-widget-id]",
                )
              ) {
                closePane();
              }
            }}
          >
            {dashboard.items.length === 0 ? (
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
                <h2 className="text-sm font-semibold text-neutral-fg">
                  Put something on this report
                </h2>
                <p className="text-sm text-neutral-fg-subtle">
                  Ask a question of your data, or add a chart you already saved.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    icon={PlusIcon}
                    label="Create question"
                    onClick={() => setIsCreateQuestionOpen(true)}
                  />
                  <Button
                    icon={PlusIcon}
                    label="Add item"
                    onClick={() =>
                      isEditable
                        ? setIsAddOpen(true)
                        : navigate({
                            to: "/dashboards/$dashboardId/edit",
                            params: { dashboardId },
                          })
                    }
                  />
                </div>
              </div>
            ) : (
              <ReaderWidthFrame readerWidth={readerWidth} scale={canvasScale}>
                <DashboardGrid
                  dashboard={dashboard}
                  isEditable={canArrange}
                  controlTransientValues={controlTransientValues}
                  selectedItemId={isPaneOpen ? paneItem?.id : null}
                  onSelectItem={selectItem}
                  transformScale={canvasScale}
                />
              </ReaderWidthFrame>
            )}
          </div>
        </div>

        <aside
          ref={setPane}
          aria-label="Report item"
          inert={!showPane}
          aria-hidden={!showPane}
          className={cn(
            "h-full min-w-0 shrink-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none",
            showPane ? "w-72" : "w-0",
          )}
        >
          <div className="h-full w-72">
            {paneItem && (
              <ReportItemPane
                key={paneItem.id}
                item={paneItem}
                dashboard={dashboard}
                onClose={closePane}
              />
            )}
          </div>
        </aside>
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

/** Publish and discard for the edit page's draft, and recovery from a stale one. */
function useReportDraftActions({
  dashboardId,
  draftReadFailed,
}: {
  dashboardId: string;
  draftReadFailed: boolean;
}) {
  const navigate = useNavigate();
  const reportDraft = useReportDraft();
  const publishDraft = useMutation(api.app.publishDraft);
  const discardDraft = useMutation(api.app.discardDraft);

  // A draft in the URL that was published or discarded elsewhere can't be
  // read. Start over from the published report instead of showing an error.
  // Publishing or discarding here ends the draft too, so that path is skipped.
  const isLeavingRef = useRef(false);
  useEffect(() => {
    if (!draftReadFailed || isLeavingRef.current) return;
    toast.error("That draft is no longer available");
    navigate({
      to: "/dashboards/$dashboardId/edit",
      params: { dashboardId },
      replace: true,
    });
  }, [dashboardId, draftReadFailed, navigate]);

  const leaveEditor = () =>
    navigate({ to: "/dashboards/$dashboardId", params: { dashboardId } });

  const publish = async () => {
    const pendingDraftId = await reportDraft?.settle();
    if (!pendingDraftId) {
      leaveEditor();
      return;
    }
    isLeavingRef.current = true;
    try {
      // No review expectations: `settle()` just drained this page's writes,
      // so the log being published is the one the author sees.
      await publishDraft({ draftId: pendingDraftId });
    } catch (error) {
      isLeavingRef.current = false;
      toast.error("Couldn't publish the report", {
        description: draftLifecycleErrorDescription(error),
        action: {
          label: "Review",
          onClick: () =>
            navigate({
              to: "/drafts/$draftId",
              params: { draftId: pendingDraftId },
            }),
        },
      });
      return;
    }
    toast.success("Report published");
    leaveEditor();
  };

  const discard = async () => {
    const pendingDraftId = await reportDraft?.settle();
    if (!pendingDraftId) {
      leaveEditor();
      return;
    }
    isLeavingRef.current = true;
    try {
      await discardDraft({ draftId: pendingDraftId });
    } catch (error) {
      isLeavingRef.current = false;
      toast.error("Couldn't discard the changes", {
        description: draftLifecycleErrorDescription(error),
      });
      return;
    }
    leaveEditor();
  };

  return { publish, discard };
}

function newReportItem(
  type: DashboardItemType,
  visualizationId: UUID,
  y: number,
) {
  return type === "visualization"
    ? {
        id: crypto.randomUUID() as UUID,
        type,
        x: 0,
        y,
        width: 6,
        height: 6,
        visualizationId,
      }
    : {
        id: crypto.randomUUID() as UUID,
        type,
        x: 0,
        y,
        width: 4,
        height: 4,
        content: "## New Text Widget\n\nEdit this text...",
      };
}

function ReportHeaderActions({
  dashboardId,
  mode,
  draftId,
  isPreviewing,
  onTogglePreview,
  onAddItem,
  onPublish,
  onDiscard,
}: {
  dashboardId: string;
  mode: "view" | "edit";
  draftId: string | undefined;
  isPreviewing: boolean;
  onTogglePreview: () => void;
  onAddItem: () => void;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  const navigate = useNavigate();
  if (mode === "view") {
    return (
      <Button
        variant="outline"
        icon={EditIcon}
        label="Edit report"
        onClick={() =>
          navigate({
            to: "/dashboards/$dashboardId/edit",
            params: { dashboardId },
          })
        }
      />
    );
  }
  return (
    <>
      <Button
        variant="outline"
        icon={isPreviewing ? EditIcon : EyeIcon}
        label={isPreviewing ? "Back to editing" : "Preview"}
        onClick={onTogglePreview}
      />
      {!isPreviewing && (
        <Button
          color="secondary"
          icon={PlusIcon}
          label="Add item"
          onClick={onAddItem}
        />
      )}
      {draftId && (
        <>
          <Button
            variant="ghost"
            label="Review changes"
            onClick={() =>
              navigate({ to: "/drafts/$draftId", params: { draftId } })
            }
          />
          <Button variant="outline" label="Discard" onClick={onDiscard} />
        </>
      )}
      <Button
        icon={CheckIcon}
        label={draftId ? "Publish" : "Done"}
        onClick={onPublish}
      />
    </>
  );
}

function reportFieldsByName(
  dashboard: Dashboard | undefined,
  visualizations: readonly Visualization[],
  insights: Insight[],
  dataTables: DataTable[],
): Map<string, CombinedField> {
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
    const fields = resolveInsightAvailableFields(insight, dataTables, insights);
    for (const field of fields) {
      const key = field.columnName ?? field.name;
      if (!map.has(key)) map.set(key, field);
    }
  }
  return map;
}

/** The report, read through the edit page's draft when there is one. */
function useReportRead(dashboardId: string, draftId: string | undefined) {
  const { data, isLoading, isError } = queryStatus(
    useQuery({
      query: api.app.listDashboards,
      args: draftId ? { draftId } : {},
    }),
  );
  const found = data?.find((candidate) => candidate.id === dashboardId);
  // The first edit moves the read onto the new draft. Keep showing the last
  // loaded report while that read starts, so the canvas doesn't unmount.
  const [lastDashboard, setLastDashboard] = useState(found);
  if (found && found !== lastDashboard) setLastDashboard(found);
  return {
    dashboard: found ?? (isLoading ? lastDashboard : undefined),
    isLoading,
    isError,
  };
}
