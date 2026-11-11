import { InsightWorkbench } from "@/components/insights/InsightWorkbench";
import { PutChartOnShelfButton } from "@/components/shelf/sources";
import { resolveInsightSourceDataTable } from "@/hooks/useInsightPagination";
import {
  buildLandChartCommands,
  chartLanding,
  countReportsUsingChart,
  deleteChartDescription,
  isReadyToLand,
  planChartDeletion,
  reportsUsingChartLabel,
  useReportChartTabs,
  type ChartTab,
} from "@/lib/reports/chart-tabs";
import {
  TABLE_CANVAS_VIEW,
  type InsightCanvasView,
} from "@/lib/insights/canvas-view";
import { useConfirmDialogStore } from "@/lib/stores";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type Dashboard,
  type DataTable,
  type Insight,
  type Visualization,
} from "@dashframe/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import { DeleteIcon, MoreIcon } from "@wystack/ui-react/icons";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

interface ReportChartTabProps {
  report: Dashboard;
  tab: ChartTab;
  /** Every report, to say where else the chart is used. */
  reports: readonly Dashboard[];
  visualizations: readonly Visualization[];
  insights: readonly Insight[];
  /** The insights have loaded, so one missing from them is gone. */
  insightsLoaded: boolean;
  dataTables: readonly DataTable[];
  /** The tables have loaded, so one missing from them is gone. */
  dataTablesLoaded: boolean;
  /** A new chart's tile is now on the report. */
  onLanded: (tabId: string) => void;
}

function CentreMessage({
  children,
  action,
}: {
  children: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <p className="text-sm text-neutral-fg-subtle">{children}</p>
      {action}
    </div>
  );
}

/** "Revenue by region": what a new chart plots, as its first name. */
export function newChartName(
  insight: Pick<Insight, "name" | "selectedFields" | "metrics">,
  dataTables: readonly Pick<DataTable, "fields">[],
): string {
  const metric = (insight.metrics ?? [])[0];
  const fieldId = insight.selectedFields[0];
  // A repeat-join field is `<uuid>_jN`; its name is the canonical field's.
  const canonicalId = fieldId?.replace(/_j\d+$/, "");
  const field = dataTables
    .flatMap((table) => table.fields ?? [])
    .find((candidate) => candidate.id === canonicalId);
  if (!metric || !field) return insight.name;
  return `${metric.name} by ${field.name}`;
}

/**
 * New-chart tabs whose chart type a suggestion picked during this page
 * session. A type restored from session storage without one belongs to a pick
 * whose write never landed before a reload.
 */
const pickedThisSession = new Set<string>();

/**
 * One chart open inside a report: the insight workbench on the chart. A new
 * chart shows its data until it has a field and a metric, then lands on the
 * report as a tile and becomes a saved chart in the same tab.
 */
export function ReportChartTab({
  report,
  tab,
  reports,
  visualizations,
  insights,
  insightsLoaded,
  dataTables,
  dataTablesLoaded,
  onLanded,
}: ReportChartTabProps) {
  const visualization = tab.insightId
    ? undefined
    : visualizations.find((candidate) => candidate.id === tab.id);
  const insightId = tab.insightId ?? visualization?.insightId;
  const insight = insights.find((candidate) => candidate.id === insightId);

  // A restored suggestion type whose write never landed (the insight is still
  // pristine) must not shape a chart then built another way, such as from
  // the left pane.
  const stalePick =
    !!tab.insightId &&
    !!tab.chartType &&
    !!insight &&
    insight.selectedFields.length === 0 &&
    (insight.metrics ?? []).length === 0 &&
    !pickedThisSession.has(tab.id);
  useEffect(() => {
    if (stalePick)
      useReportChartTabs.getState().setChartType(report.id, tab.id, undefined);
  }, [report.id, stalePick, tab.id]);

  const commitBatch = useMutation(api.app.commitBatch);
  const landAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tab.insightId || !insight || !isReadyToLand(insight)) return;
    // One attempt per tab: StrictMode replays, re-renders, and a remount while
    // the batch is in flight must not place the chart twice. Once it commits,
    // the report sees the chart and hands this tab over as a saved chart.
    if (chartLanding.isPending(tab.id)) return;
    if (landAttemptRef.current === tab.id) return;
    landAttemptRef.current = tab.id;
    const commands = buildLandChartCommands({
      chartId: tab.id,
      report,
      insight,
      name: newChartName(insight, dataTables),
      chartType: tab.chartType,
    });
    chartLanding.start(tab.id);
    commitBatch({ commands })
      .then(() => onLanded(tab.id))
      .catch((error: unknown) => {
        console.error("[ReportChartTab] placing the chart failed:", error);
        landAttemptRef.current = null;
        toast.error("Couldn't place the chart on the report");
      })
      .finally(() => chartLanding.finish(tab.id));
  }, [commitBatch, dataTables, insight, onLanded, report, tab]);

  const deleteChart = useDeleteChart({
    chart: visualization,
    reportId: report.id,
    reports,
    visualizations,
    insights,
  });

  const view = useMemo<InsightCanvasView>(
    () =>
      visualization
        ? { kind: "visualization", visualizationId: visualization.id }
        : TABLE_CANVAS_VIEW,
    [visualization],
  );

  if (tab.creating) return <CentreMessage>Starting the chart...</CentreMessage>;
  if (!insight || (!tab.insightId && !visualization)) {
    return (
      <CentreMessage>
        {insightsLoaded
          ? "This chart is gone. Close its tab to go back to the report."
          : "Loading chart..."}
      </CentreMessage>
    );
  }

  const tableGone =
    dataTablesLoaded &&
    insightsLoaded &&
    !resolveInsightSourceDataTable(insight, dataTables, insights);

  const usedIn = visualization
    ? reportsUsingChartLabel(countReportsUsingChart(reports, visualization.id))
    : undefined;

  return (
    <InsightWorkbench
      insight={insight}
      view={view}
      leftPaneNote={usedIn}
      starter={
        visualization
          ? undefined
          : {
              onPickChartType: (chartType) => {
                if (chartType) pickedThisSession.add(tab.id);
                else pickedThisSession.delete(tab.id);
                useReportChartTabs
                  .getState()
                  .setChartType(report.id, tab.id, chartType);
              },
            }
      }
      missingTable={
        <CentreMessage
          // A saved chart without its table can only be deleted, and the
          // header that holds the menu is not shown here. The workbench also
          // shows this while its own lists load, so the action waits for
          // this tab's loaded lists to say the table is gone.
          action={
            visualization &&
            tableGone && (
              <Button
                label="Delete chart"
                icon={DeleteIcon}
                variant="outline"
                size="sm"
                disabled={deleteChart.isDeleting}
                onClick={deleteChart.request}
              />
            )
          }
        >
          This chart's table is gone. It may have been deleted.
        </CentreMessage>
      }
      header={
        visualization ? (
          <>
            <ChartNameInput
              key={visualization.id}
              visualization={visualization}
            />
            <PutChartOnShelfButton chart={visualization} />
            <ChartActions deleteChart={deleteChart} />
          </>
        ) : (
          <>
            <span className="px-1 text-sm font-semibold text-neutral-fg">
              Untitled chart
            </span>
            <span className="min-w-0 truncate text-xs text-neutral-fg-subtle">
              Add a field and a metric to place it on the report
            </span>
          </>
        )
      }
    />
  );
}

interface DeleteChart {
  /** Asks for confirmation, then deletes the chart. */
  request: () => void;
  isDeleting: boolean;
}

/**
 * Deleting a saved chart: its tiles on every report, the chart, and its
 * insight when nothing else is built on it. Once the chart is gone the report
 * stops showing its tab and opens in its place.
 */
function useDeleteChart(input: {
  /** Undefined for a new chart, which has nothing saved to delete. */
  chart: Visualization | undefined;
  reportId: string;
  reports: readonly Dashboard[];
  visualizations: readonly Visualization[];
  insights: readonly Insight[];
}): DeleteChart {
  const commitBatch = useMutation(api.app.commitBatch);
  const confirm = useConfirmDialogStore((state) => state.confirm);
  const [isDeleting, setIsDeleting] = useState(false);
  // Read when the dialog opens and again when it is confirmed, which may be
  // a while later.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  // The dialog outlives this tab (it is the app's one confirm dialog), but
  // only this tab knows what a confirm would remove: leaving closes it.
  const asking = useRef(false);
  useEffect(
    () => () => {
      if (asking.current) useConfirmDialogStore.getState().close();
    },
    [],
  );

  const ask = (changed: boolean) => {
    const { chart } = latest.current;
    if (!chart) return;
    const plan = () => {
      const { chart: _current, ...lists } = latest.current;
      const deletion = planChartDeletion({ chart, ...lists });
      return {
        ...deletion,
        description: deleteChartDescription(
          chart.name || "Untitled chart",
          deletion,
        ),
      };
    };
    const first = plan();
    if (first.tooManyTiles) {
      toast.error(
        "This chart has too many tiles to delete at once. Remove some from its reports first.",
      );
      return;
    }
    const asked = first.description;
    confirm({
      title: "Delete chart",
      description: changed
        ? `Where this chart is used changed while you were deciding. ${asked}`
        : asked,
      confirmLabel: "Delete",
      variant: "destructive",
      onCancel: () => {
        asking.current = false;
      },
      onConfirm: async () => {
        asking.current = false;
        const deletion = plan();
        // What the dialog said no longer holds (a tile was placed, or another
        // chart on the insight went): ask again, saying so, rather than
        // remove more or less than the user agreed to.
        if (deletion.description !== asked || deletion.tooManyTiles) {
          ask(true);
          return;
        }
        setIsDeleting(true);
        try {
          await commitBatch({ commands: deletion.commands });
        } catch (error) {
          console.error("[ReportChartTab] deleting the chart failed:", error);
          toast.error("Couldn't delete the chart");
          setIsDeleting(false);
          return;
        }
        // Its tab is hidden once the chart is gone; drop the stored records.
        const tabs = useReportChartTabs.getState();
        for (const [openIn, open] of Object.entries(tabs.tabsByReport)) {
          if (open.some((tab) => tab.id === chart.id)) {
            tabs.close(openIn, chart.id);
          }
        }
      },
    });
    // After `confirm`: opening cancels a dialog already open, this one's too.
    asking.current = true;
  };

  return { request: () => ask(false), isDeleting };
}

/** The saved chart's overflow menu. */
function ChartActions({ deleteChart }: { deleteChart: DeleteChart }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // Sized like the shelf button beside it, so its focus ring fits the
          // header's height.
          <Button
            label="More chart actions"
            aria-label="More chart actions"
            tooltip="More chart actions"
            variant="ghost"
            size="sm"
            className="h-6 w-6"
            disabled={deleteChart.isDeleting}
          >
            <MoreIcon aria-hidden className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={deleteChart.request}
          className="text-palette-danger focus:text-palette-danger"
        >
          <DeleteIcon className="mr-2 h-4 w-4" />
          Delete chart
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The chart's name, renamed in place: saved on Enter or when focus leaves. */
function ChartNameInput({
  visualization,
}: {
  visualization: Pick<Visualization, "id" | "name">;
}) {
  const commitBatch = useMutation(api.app.commitBatch);
  const [name, setName] = useState(visualization.name);
  const [savedName, setSavedName] = useState(visualization.name);
  // A rename from elsewhere replaces the field unless it holds an edit.
  if (visualization.name !== savedName) {
    setSavedName(visualization.name);
    if (name === savedName) setName(visualization.name);
  }

  const cancelRef = useRef(false);

  const save = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setName(visualization.name);
      return;
    }
    const next = name.trim();
    if (!next || next === visualization.name) {
      setName(visualization.name);
      return;
    }
    commitBatch({
      commands: [cmd("RenameNode", { id: visualization.id, name: next })],
    }).catch(() => {
      toast.error("Couldn't rename the chart");
      setName(visualization.name);
    });
  };

  return (
    <>
      <label className="sr-only" htmlFor="report-chart-name">
        Chart name
      </label>
      <input
        id="report-chart-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelRef.current = true;
            event.currentTarget.blur();
          }
        }}
        placeholder="Untitled chart"
        className="min-w-16 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-fg outline-none placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary"
      />
    </>
  );
}
