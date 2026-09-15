import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import { ArtifactPageHeader } from "@/components/artifacts/ArtifactPageHeader";
import { queryStatus } from "@/data/query-status";
import { ControlTooltip } from "@dashframe/ui";
import { useAppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CHROME_ICON_BUTTON_CLASS } from "@/components/shell/layout-constants";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { useBindArtifact } from "@/components/assistant/artifact-context";
import { DashboardControlBar } from "@/components/dashboards/DashboardControlBar";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import {
  ReportFrame,
  useReportFrame,
} from "@/components/dashboards/ReportFrame";
import { ReportFrameControls } from "@/components/dashboards/ReportFrameControls";
import { ReportItemPane } from "@/components/dashboards/ReportItemPane";
import { ReportSettingsPane } from "@/components/dashboards/ReportSettingsPane";
import {
  ReportCanvasWell,
  ReportWorkbenchHeader,
  ReportWorkbenchLayout,
} from "@/components/dashboards/ReportWorkbenchLayout";
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
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  ButtonPrimitive,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  EyeIcon,
  FileIcon,
  MoreIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  // Preview shows the draft as a reader sees it: no panes, no editing chrome,
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
  useAppBreadcrumbs(
    dashboard
      ? [
          { label: "Reports", to: "/dashboards" },
          { label: dashboard.name || "Untitled report" },
        ]
      : null,
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
  const [isReportPaneOpen, setIsReportPaneOpen] = useState(true);
  // The item pane keeps rendering its last item while it closes, so the width
  // transition collapses real content instead of an empty column.
  const [paneItemId, setPaneItemId] = useState<string | null>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const frame = useEditorFrame(canArrange);

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
  // Field types come from the insights, so wait for them before showing inputs.
  const controls = questionMetadataAvailable
    ? (dashboard.controls ?? [])
    : null;

  const canvas = (
    <ReportCanvasWell setCanvas={frame.setCanvas} onBackgroundClick={closePane}>
      {dashboard.items.length === 0 ? (
        <EmptyReport
          onCreateQuestion={() => setIsCreateQuestionOpen(true)}
          onAddItem={() =>
            isEditable
              ? setIsAddOpen(true)
              : navigate({
                  to: "/dashboards/$dashboardId/edit",
                  params: { dashboardId },
                })
          }
        />
      ) : (
        <ReportFrame
          width={frame.width}
          scale={frame.scale}
          onResize={frame.resizeFrame}
          onResizingChange={frame.holdScale}
        >
          <DashboardGrid
            dashboard={dashboard}
            isEditable={canArrange}
            controlTransientValues={controlTransientValues}
            selectedItemId={isPaneOpen ? paneItem?.id : null}
            onSelectItem={selectItem}
            transformScale={frame.scale}
          />
        </ReportFrame>
      )}
    </ReportCanvasWell>
  );

  return (
    <>
      {isEditable ? (
        <ReportWorkbenchLayout
          header={
            <ReportEditorHeader
              draftId={draftId}
              isPreviewing={isPreviewing}
              onTogglePreview={() =>
                setIsPreviewing((previewing) => !previewing)
              }
              onAddItem={() => setIsAddOpen(true)}
              onPublish={publish}
              onDiscard={discard}
              reportPaneOpen={isReportPaneOpen}
              onToggleReportPane={() => setIsReportPaneOpen((open) => !open)}
              itemPane={
                paneItem === undefined
                  ? null
                  : {
                      attached: showPane,
                      onToggle: () => setIsPaneOpen((open) => !open),
                    }
              }
              frameControls={
                dashboard.items.length > 0 && (
                  <ReportFrameControls
                    width={frame.width}
                    scale={frame.scale}
                    chosenWidth={frame.frameWidth}
                    zoom={frame.frameZoom}
                    onWidthChange={frame.setFrameWidth}
                    onZoomChange={frame.setFrameZoom}
                  />
                )
              }
            />
          }
          leftPane={
            <ReportSettingsPane
              controls={controls}
              fieldsByName={fieldsByName}
              transientValues={controlTransientValues}
              onTransientChange={setControlTransientValues}
            />
          }
          leftOpen={canArrange && isReportPaneOpen}
          setLeftPane={frame.setLeftPane}
          rightPane={
            paneItem && (
              <ReportItemPane
                key={paneItem.id}
                item={paneItem}
                dashboard={dashboard}
                onClose={closePane}
              />
            )
          }
          rightOpen={showPane}
          setRightPane={frame.setRightPane}
        >
          {canvas}
        </ReportWorkbenchLayout>
      ) : (
        <div className="flex h-full flex-col">
          <ArtifactPageHeader
            title={dashboard.name}
            actions={
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
            }
          />
          {/* Same horizontal chrome as the workbench's canvas section, so the
              report lays out at the width the editor previews. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-1.5 py-2">
            <DashboardControlBar
              controls={controls ?? []}
              fieldsByName={fieldsByName}
              transientValues={controlTransientValues}
              onTransientChange={setControlTransientValues}
              className="border-b-0 px-3 py-2"
            />
            {canvas}
          </div>
        </div>
      )}

      <CreateVisualizationModal
        isOpen={isCreateQuestionOpen}
        onClose={() => setIsCreateQuestionOpen(false)}
        title="Create question"
        reportId={dashboardId}
      />
      <AddReportItemDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        dashboard={dashboard}
        visualizations={visualizations}
      />
    </>
  );
}

function EmptyReport({
  onCreateQuestion,
  onAddItem,
}: {
  onCreateQuestion: () => void;
  onAddItem: () => void;
}) {
  return (
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
          onClick={onCreateQuestion}
        />
        <Button icon={PlusIcon} label="Add item" onClick={onAddItem} />
      </div>
    </div>
  );
}

function AddReportItemDialog({
  open,
  onOpenChange,
  dashboard,
  visualizations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: Dashboard;
  visualizations: readonly Visualization[];
}) {
  const writeReport = useReportWrite();
  const [isAddPending, setIsAddPending] = useState(false);
  const [addType, setAddType] = useState<DashboardItemType>("visualization");
  const [selectedVizId, setSelectedVizId] = useState<string>("");

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
            dashboardId: dashboard.id,
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

    onOpenChange(false);
    setAddType("visualization");
    setSelectedVizId("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
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

/**
 * The frame width and zoom are editor-only: viewing and previewing always lay
 * the report out at the reader's width in this window, at full size.
 */
function useEditorFrame(canArrange: boolean) {
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [frameZoom, setFrameZoom] = useState<number | null>(null);
  const frame = useReportFrame({
    width: canArrange ? frameWidth : null,
    zoom: canArrange ? frameZoom : null,
  });
  return {
    ...frame,
    frameWidth,
    frameZoom,
    setFrameWidth,
    setFrameZoom,
    resizeFrame: canArrange ? setFrameWidth : undefined,
  };
}

function ReportEditorHeader({
  draftId,
  isPreviewing,
  onTogglePreview,
  onAddItem,
  onPublish,
  onDiscard,
  reportPaneOpen,
  onToggleReportPane,
  itemPane,
  frameControls,
}: {
  draftId: string | undefined;
  isPreviewing: boolean;
  onTogglePreview: () => void;
  onAddItem: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  reportPaneOpen: boolean;
  onToggleReportPane: () => void;
  /** The item pane's toggle, once an item has been selected. */
  itemPane: { attached: boolean; onToggle: () => void } | null;
  frameControls: ReactNode;
}) {
  const status = isPreviewing
    ? "Previewing as a reader"
    : draftId && "Unpublished changes";
  return (
    <ReportWorkbenchHeader>
      {!isPreviewing && (
        <Button
          size="sm"
          variant="ghost"
          icon={reportPaneOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
          iconOnly
          label={reportPaneOpen ? "Collapse Report pane" : "Expand Report pane"}
          onClick={onToggleReportPane}
          className={CHROME_ICON_BUTTON_CLASS}
        />
      )}
      <div className="flex-1" />
      {status && (
        <span className="hidden max-w-48 min-w-0 truncate text-xs text-neutral-fg-subtle @min-5xl:inline">
          {status}
        </span>
      )}
      {!isPreviewing && frameControls}
      <ControlTooltip
        label={isPreviewing ? "Back to editing" : "Preview"}
        description={
          isPreviewing ? undefined : "See the report as readers will."
        }
      >
        <Button
          size="sm"
          variant="outline"
          label={isPreviewing ? "Back to editing" : "Preview"}
          onClick={onTogglePreview}
        >
          {isPreviewing ? <EditIcon aria-hidden /> : <EyeIcon aria-hidden />}
          <span className="@max-3xl:sr-only">
            {isPreviewing ? "Back to editing" : "Preview"}
          </span>
        </Button>
      </ControlTooltip>
      {!isPreviewing && (
        <ControlTooltip label="Add item" description="Place a chart or text.">
          <Button
            size="sm"
            variant="outline"
            label="Add item"
            onClick={onAddItem}
          >
            <PlusIcon aria-hidden />
            <span className="@max-3xl:sr-only">Add item</span>
          </Button>
        </ControlTooltip>
      )}
      <ReportDraftMenu draftId={draftId} onDiscard={onDiscard} />
      <ControlTooltip
        label={draftId ? "Publish" : "Done"}
        description={
          draftId ? "Readers see these changes once published." : undefined
        }
      >
        <Button
          size="sm"
          label={draftId ? "Publish" : "Done"}
          onClick={onPublish}
        >
          <CheckIcon aria-hidden />
          <span className="@max-xl:sr-only">
            {draftId ? "Publish" : "Done"}
          </span>
        </Button>
      </ControlTooltip>
      {!isPreviewing && itemPane && (
        <Button
          size="sm"
          variant="ghost"
          icon={itemPane.attached ? PanelRightCloseIcon : PanelRightOpenIcon}
          iconOnly
          label={itemPane.attached ? "Collapse Item pane" : "Expand Item pane"}
          onClick={itemPane.onToggle}
          className={CHROME_ICON_BUTTON_CLASS}
        />
      )}
    </ReportWorkbenchHeader>
  );
}

/** Review and discard for an unpublished draft. */
function ReportDraftMenu({
  draftId,
  onDiscard,
}: {
  draftId: string | undefined;
  onDiscard: () => void;
}) {
  const navigate = useNavigate();
  if (!draftId) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ButtonPrimitive
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More actions"
            title="More actions"
            className="h-8 w-8 shrink-0"
          >
            <MoreIcon aria-hidden />
          </ButtonPrimitive>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            navigate({ to: "/drafts/$draftId", params: { draftId } })
          }
        >
          Review changes
        </DropdownMenuItem>
        <DropdownMenuItem className="text-palette-danger" onClick={onDiscard}>
          Discard changes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
