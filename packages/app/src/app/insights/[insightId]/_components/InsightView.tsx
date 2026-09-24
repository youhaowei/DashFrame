import {
  InsightWorkbench,
  requestSavedVisualizationDeletion,
  resolveAddToReportTarget,
  type InsightWorkbenchHeaderContext,
} from "@/components/insights/InsightWorkbench";
import { AppLayout } from "@/components/layouts/AppLayout";
import { NotFoundView } from "./NotFoundView";
import { visualizationDetailLink } from "@/components/visualizations/visualization-navigation";
import { queryStatus } from "@/data/query-status";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import {
  TABLE_CANVAS_VIEW,
  useInsightCanvasStore,
  type InsightCanvasView,
} from "@/lib/stores/insight-canvas-store";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { api } from "@dashframe/convex-backend/api";
import { cmd, type Insight, type UUID } from "@dashframe/types";
import { ControlTooltip } from "@dashframe/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Button,
  ButtonPrimitive,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import { DashboardIcon, MoreIcon, PlusIcon } from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface InsightViewProps {
  insight: Insight;
  visualizeIntent?: boolean;
  reportId?: string;
}

function InsightMoreActionsMenu({
  savedChart,
  onDuplicateChart,
  onDeleteChart,
}: {
  savedChart: { id: UUID; name: string };
  onDuplicateChart: (id: UUID) => void;
  onDeleteChart: (id: UUID, name: string) => void;
}) {
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
        <DropdownMenuItem onClick={() => onDuplicateChart(savedChart.id)}>
          Duplicate chart
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-palette-danger"
          onClick={() => onDeleteChart(savedChart.id, savedChart.name)}
        >
          Delete chart
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The insight page: the insight workbench with the insight's own views as
 * top-bar tabs, its name in the header, and the actions that place a chart
 * on a report.
 */
export function InsightView({
  insight,
  visualizeIntent = false,
  reportId,
}: InsightViewProps) {
  const insightId = insight.id;
  const navigate = useNavigate();
  const commitBatch = useMutation(api.app.commitBatch);
  const { confirm } = useConfirmDialogStore();

  const view =
    useInsightCanvasStore((s) => s.activeViewByInsight[insightId]) ??
    TABLE_CANVAS_VIEW;
  const setActiveView = useInsightCanvasStore((s) => s.setActiveView);
  const handleViewChange = useCallback(
    (next: InsightCanvasView) => setActiveView(insightId, next),
    [insightId, setActiveView],
  );

  const {
    data: dashboards = [],
    isPending: dashboardsPending,
    isError: dashboardsError,
  } = queryStatus(useQuery({ query: api.app.listDashboards, args: {} }));
  const addToReportTarget = resolveAddToReportTarget({
    reportId,
    dashboards,
    isPending: dashboardsPending,
    isError: dashboardsError,
  });

  // Local state for insight name (prevents re-renders on typing)
  const [localName, setLocalName] = useState(insight.name);
  const updateWebMCPInsight = useWebMCPPageStore(
    (state) => state.updateInsight,
  );
  useEffect(() => {
    updateWebMCPInsight(insightId, {
      pendingName: localName !== insight.name ? localName : undefined,
    });
  }, [insight.name, insightId, localName, updateWebMCPInsight]);
  const prevInsightNameRef = useRef(insight.name);
  // Sync local name when insight prop changes from an external source.
  useEffect(() => {
    if (prevInsightNameRef.current !== insight.name) {
      prevInsightNameRef.current = insight.name;
      setLocalName(insight.name);
    }
  }, [insight.name]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Debounced save for insight name (500ms after typing stops)
  const handleNameChange = useCallback(
    (newName: string) => {
      setLocalName(newName);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        if (newName !== insight.name) {
          // Fire-and-forget from a debounce: surface a failure but leave the
          // field on the user's latest input. We deliberately don't roll the
          // field back — with overlapping debounced renames a rollback would
          // race (clobbering newer input, or restoring a pre-edit name over a
          // partial success); the next keystroke's debounce simply retries.
          commitBatch({
            commands: [cmd("RenameNode", { id: insightId, name: newName })],
          }).catch(() => toast.error("Couldn't rename the insight"));
        }
      }, 500);
    },
    [insightId, insight.name, commitBatch],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleAddActiveViewToDashboard = async (
    ensureActiveVisualization: () => Promise<UUID | null>,
  ) => {
    try {
      if (addToReportTarget.kind === "pending") return;
      if (addToReportTarget.kind === "query-error") {
        toast.error("Couldn't load reports");
        return;
      }
      if (addToReportTarget.kind === "missing-report") {
        toast.error("This report is no longer available");
        return;
      }
      const dashboard = addToReportTarget.dashboard;
      const visualizationId = await ensureActiveVisualization();
      if (!visualizationId) return;
      const dashboardId = dashboard?.id ?? (crypto.randomUUID() as UUID);
      const bottomY =
        dashboard?.items.reduce(
          (max, item) => Math.max(max, item.y + item.height),
          0,
        ) ?? 0;

      await commitBatch({
        commands: [
          ...(dashboard
            ? []
            : [
                cmd("CreateDashboard", {
                  id: dashboardId,
                  name: `${insight.name} dashboard`,
                }),
              ]),
          cmd("AddDashboardItem", {
            dashboardId,
            item: {
              id: crypto.randomUUID() as UUID,
              type: "visualization",
              visualizationId,
              x: 0,
              y: bottomY,
              width: 6,
              height: 6,
            },
          }),
        ],
      });
      toast.success("Added to report");
      if (reportId) navigate({ to: `/dashboards/${reportId}` } as never);
    } catch (error) {
      console.error("[InsightView] Add to dashboard failed:", error);
      toast.error("Couldn't add to dashboard");
    }
  };

  const handleDuplicateVisualization = async (
    context: InsightWorkbenchHeaderContext,
    vizId: string,
  ) => {
    const viz = context.insightVisualizations.find((v) => v.id === vizId);
    if (!viz) return;
    const newVizId = crypto.randomUUID() as UUID;
    await commitBatch({
      commands: [
        cmd("CreateVisualization", {
          id: newVizId,
          name: `${viz.name} (copy)`,
          insightId,
          visualizationType: viz.visualizationType,
          spec: viz.spec,
          encoding: viz.encoding,
        }),
      ],
    });
    navigate(visualizationDetailLink(newVizId, reportId) as never);
  };

  const handleDeleteVisualization = (vizId: string, name: string) => {
    requestSavedVisualizationDeletion(
      confirm,
      ({ id }) =>
        commitBatch({ commands: [cmd("DeleteNode", { id: id as UUID })] }),
      vizId,
      name,
    );
  };

  const renderHeader = (context: InsightWorkbenchHeaderContext) => {
    const { activeView, activeVisualization, canPinActiveChart } = context;
    const canAddActiveViewToDashboard =
      (activeView.kind === "visualization" || canPinActiveChart) &&
      addToReportTarget.kind !== "pending";
    return (
      <>
        <Link
          to="/insights"
          className="shrink-0 rounded-sm px-1 @max-2xl:hidden text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
        >
          Insights
        </Link>
        <span
          aria-hidden
          className="shrink-0 text-xs text-neutral-fg-subtle @max-2xl:hidden"
        >
          ›
        </span>
        <label className="sr-only" htmlFor="insight-name">
          Insight name
        </label>
        <input
          id="insight-name"
          value={localName}
          onChange={(event) => handleNameChange(event.target.value)}
          placeholder="Untitled insight"
          className="min-w-16 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-fg outline-none placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary"
        />
        {canPinActiveChart && (
          <ControlTooltip
            label="Save chart"
            description="Keep this chart as a reusable view for dashboards."
          >
            <Button
              size="sm"
              variant="outline"
              label="Save chart"
              onClick={context.pinActiveChart}
            >
              <PlusIcon aria-hidden />
              <span className="@max-xl:sr-only">Save chart</span>
            </Button>
          </ControlTooltip>
        )}
        <ControlTooltip
          label="Add to report"
          description="Place this view on a report."
        >
          <Button
            size="sm"
            label="Add to report"
            onClick={() =>
              handleAddActiveViewToDashboard(context.ensureActiveVisualization)
            }
            disabled={!canAddActiveViewToDashboard}
          >
            <DashboardIcon aria-hidden />
            <span className="@max-xl:sr-only">Add to report</span>
          </Button>
        </ControlTooltip>
        {activeView.kind === "visualization" && activeVisualization && (
          <InsightMoreActionsMenu
            savedChart={activeVisualization}
            onDuplicateChart={(id) =>
              void handleDuplicateVisualization(context, id)
            }
            onDeleteChart={handleDeleteVisualization}
          />
        )}
      </>
    );
  };

  return (
    <AppLayout pageHeader={null} childrenClassName="overflow-hidden">
      <InsightWorkbench
        insight={insight}
        view={view}
        onViewChange={handleViewChange}
        reportId={reportId}
        visualizeIntent={visualizeIntent}
        canvasTabs
        header={renderHeader}
        missingTable={<NotFoundView type="dataTable" />}
      />
    </AppLayout>
  );
}
