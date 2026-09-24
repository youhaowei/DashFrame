import { InsightWorkbench } from "@/components/insights/InsightWorkbench";
import {
  buildLandChartCommands,
  chartLanding,
  countReportsUsingChart,
  isReadyToLand,
  reportsUsingChartLabel,
  type ChartTab,
} from "@/lib/reports/chart-tabs";
import {
  TABLE_CANVAS_VIEW,
  type InsightCanvasView,
} from "@/lib/stores/insight-canvas-store";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type Dashboard,
  type DataTable,
  type Insight,
  type Visualization,
} from "@dashframe/types";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  /** A new chart's tile is now on the report. */
  onLanded: (tabId: string) => void;
}

const ignoreViewChange = (_view: InsightCanvasView) => {};

function CentreMessage({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-sm text-neutral-fg-subtle">{children}</p>
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
  onLanded,
}: ReportChartTabProps) {
  const visualization = tab.insightId
    ? undefined
    : visualizations.find((candidate) => candidate.id === tab.id);
  const insightId = tab.insightId ?? visualization?.insightId;
  const insight = insights.find((candidate) => candidate.id === insightId);

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

  const view = useMemo<InsightCanvasView>(
    () =>
      visualization
        ? { kind: "visualization", visualizationId: visualization.id }
        : TABLE_CANVAS_VIEW,
    [visualization],
  );

  if (!insight || (!tab.insightId && !visualization)) {
    return (
      <CentreMessage>
        {insightsLoaded
          ? "This chart is gone. Close its tab to go back to the report."
          : "Loading chart..."}
      </CentreMessage>
    );
  }

  const usedIn = visualization
    ? reportsUsingChartLabel(countReportsUsingChart(reports, visualization.id))
    : undefined;

  return (
    <InsightWorkbench
      insight={insight}
      view={view}
      onViewChange={ignoreViewChange}
      reportId={report.id}
      leftPaneNote={usedIn}
      missingTable={
        <CentreMessage>
          This chart's table is gone. It may have been deleted.
        </CentreMessage>
      }
      header={() =>
        visualization ? (
          <ChartNameInput
            key={visualization.id}
            visualization={visualization}
          />
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
