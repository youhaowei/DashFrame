/**
 * Report item pane — the attached right pane for the item selected on a report.
 *
 * A chart item gets the same chart configuration as the insight workbench's
 * Visualization pane (chart type, encodings, saved charts). Edits made here are
 * stored as this item's `visualization` override, so the saved chart and its
 * insight stay unchanged and other reports placing the chart are unaffected.
 * Runtime overrides (filters, sort, limit) stay on the chart cell itself.
 *
 * A text item shows its markdown source, saved on blur.
 */

import { useQuery_experimental as useQuery } from "convex/react";
import {
  INSIGHT_CANVAS_CHART_TYPES,
  VisualizationConfigPanel,
} from "@/app/insights/[insightId]/_components/VisualizationConfigPanel";
import {
  savedChartTypeOptions,
  useSavedChartEncodingOptions,
} from "@/components/visualizations/useSavedChartEncodingOptions";
import { queryStatus } from "@/data/query-status";
import { resolveInsightAuthoringTable } from "@/lib/insights/compute-combined-fields";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type Dashboard,
  type DashboardItem,
  type DashboardItemDisplay,
  type DataTable,
  type Insight,
  type UUID,
  type Visualization,
  type VisualizationEncoding,
  type VisualizationType,
} from "@dashframe/types";
import { WorkbenchPaneHeader, WorkbenchPaneSection } from "@dashframe/ui";
import { Link } from "@tanstack/react-router";
import { Button, Toggle } from "@wystack/ui-react";
import {
  ChartIcon,
  DeleteIcon,
  LayersIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import { PanelTop, Type } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useReportWrite } from "./report-write";

interface ReportItemPaneProps {
  item: DashboardItem;
  dashboard: Dashboard;
  onClose: () => void;
}

export function ReportItemPane({
  item,
  dashboard,
  onClose,
}: ReportItemPaneProps) {
  const writeReport = useReportWrite();

  const handleRemove = async () => {
    try {
      await writeReport({
        commands: [
          cmd("RemoveDashboardItem", {
            dashboardId: dashboard.id,
            itemId: item.id,
          }),
        ],
      });
      onClose();
    } catch {
      toast.error("Couldn't remove the item");
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-neutral-bg text-xs">
      {item.type === "markdown" ? (
        <TextItemPane item={item} dashboardId={dashboard.id} />
      ) : (
        <ChartItemPane item={item} dashboard={dashboard} />
      )}
      <div className="shrink-0 px-3 pt-1 pb-3">
        <Button
          size="sm"
          variant="ghost"
          label="Remove from report"
          className="w-full justify-start text-palette-danger hover:bg-palette-danger/10 hover:text-palette-danger"
          onClick={handleRemove}
        >
          <DeleteIcon className="h-3.5 w-3.5" aria-hidden />
          Remove from report
        </Button>
      </div>
    </div>
  );
}

function PaneMessage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <WorkbenchPaneHeader title={title}>{null}</WorkbenchPaneHeader>
      <p className="flex-1 px-4 py-2 text-neutral-fg-subtle">{children}</p>
    </>
  );
}

function TextItemPane({
  item,
  dashboardId,
}: {
  item: DashboardItem;
  dashboardId: UUID;
}) {
  const writeReport = useReportWrite();
  const content = item.content ?? "";
  // Local draft so typing doesn't fire a mutation per keystroke; commits on
  // blur. A saved change arriving from elsewhere replaces the draft.
  const [draft, setDraft] = useState(content);
  const [syncedContent, setSyncedContent] = useState(content);
  if (content !== syncedContent) {
    setSyncedContent(content);
    setDraft(content);
  }

  const commit = async () => {
    if (draft === content) return;
    try {
      await writeReport({
        commands: [
          cmd("UpdateDashboardItem", {
            dashboardId,
            itemId: item.id,
            updates: { content: draft },
          }),
        ],
      });
    } catch {
      toast.error("Couldn't save the text");
    }
  };

  return (
    <>
      <WorkbenchPaneHeader title="Text">{null}</WorkbenchPaneHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 pb-2">
        <label
          htmlFor={`report-text-${item.id}`}
          className="flex items-center gap-1.5 px-0.5 text-[11px] text-neutral-fg-subtle"
        >
          <Type className="h-3.5 w-3.5" aria-hidden />
          Markdown
        </label>
        <textarea
          id={`report-text-${item.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          placeholder="Write a heading, a note, or a finding…"
          className="min-h-40 w-full flex-1 resize-none rounded-md bg-neutral-bg-subtle px-2.5 py-2 font-mono text-xs shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] ring-[0.5px] ring-neutral-border/60 outline-none placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary"
        />
      </div>
    </>
  );
}

function ChartItemPane({
  item,
  dashboard,
}: {
  item: DashboardItem;
  dashboard: Dashboard;
}) {
  const { data: visualizations = [], isLoading: visualizationsLoading } =
    queryStatus(useQuery({ query: api.app.listVisualizations, args: {} }));
  const { data: insights = [], isLoading: insightsLoading } = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  );
  const { data: dataTables = [], isLoading: dataTablesLoading } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );

  const savedVisualization = visualizations.find(
    (candidate) => candidate.id === item.visualizationId,
  );
  const insight = savedVisualization
    ? insights.find(
        (candidate) => candidate.id === savedVisualization.insightId,
      )
    : undefined;
  const authoringTable = insight
    ? resolveInsightAuthoringTable(insight, dataTables, insights)
    : undefined;

  if (visualizationsLoading || insightsLoading || dataTablesLoading) {
    return <PaneMessage title="Visualization">Loading chart…</PaneMessage>;
  }
  if (!savedVisualization || !insight || !authoringTable) {
    return (
      <PaneMessage title="Visualization">
        This saved chart is no longer available.
      </PaneMessage>
    );
  }
  return (
    <ChartConfig
      item={item}
      dashboardId={dashboard.id}
      savedVisualization={savedVisualization}
      insight={insight}
      authoringTable={authoringTable}
      insightVisualizations={visualizations.filter(
        (candidate) => candidate.insightId === insight.id,
      )}
    />
  );
}

function sameEncoding(
  a: VisualizationEncoding | undefined,
  b: VisualizationEncoding | undefined,
): boolean {
  const left: Record<string, unknown> = { ...a };
  const right: Record<string, unknown> = { ...b };
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function ChartConfig({
  item,
  dashboardId,
  savedVisualization,
  insight,
  authoringTable,
  insightVisualizations,
}: {
  item: DashboardItem;
  dashboardId: UUID;
  savedVisualization: Visualization;
  insight: Insight;
  authoringTable: DataTable;
  insightVisualizations: Visualization[];
}) {
  const writeReport = useReportWrite();
  const override = item.overrides?.visualization;
  const effectiveVisualization = useMemo(
    () =>
      override ? { ...savedVisualization, ...override } : savedVisualization,
    [override, savedVisualization],
  );
  const options = useSavedChartEncodingOptions({ insight, enabled: true });
  const availableChartTypes = useMemo(
    () =>
      savedChartTypeOptions(
        effectiveVisualization,
        INSIGHT_CANVAS_CHART_TYPES,
        options.isReady,
        options.columnAnalysis,
        options.compiledInsight,
      ),
    [
      effectiveVisualization,
      options.columnAnalysis,
      options.compiledInsight,
      options.isReady,
    ],
  );

  // The editor sends only what changed relative to the chart it was given, so
  // fill the rest from this item's effective chart. A result equal to the
  // saved chart clears the override instead of storing a copy of it.
  const updateVisualization = useCallback(
    ({
      updates,
    }: {
      id: UUID;
      updates: {
        visualizationType?: VisualizationType;
        encoding?: VisualizationEncoding;
      };
    }) => {
      const next = {
        visualizationType:
          updates.visualizationType ?? effectiveVisualization.visualizationType,
        encoding: updates.encoding ?? effectiveVisualization.encoding,
      };
      const matchesSaved =
        next.visualizationType === savedVisualization.visualizationType &&
        sameEncoding(next.encoding, savedVisualization.encoding);
      return writeReport({
        commands: [
          cmd("PatchDashboardItemOverride", {
            dashboardId,
            itemId: item.id,
            patch: { kind: "visualization", value: matchesSaved ? null : next },
          }),
        ],
      });
    },
    [
      writeReport,
      dashboardId,
      effectiveVisualization,
      item.id,
      savedVisualization,
    ],
  );

  const handleSelectVisualization = (visualizationId: UUID) => {
    if (visualizationId === item.visualizationId) return;
    writeReport({
      commands: [
        cmd("PatchDashboardItemOverride", {
          dashboardId,
          itemId: item.id,
          patch: { kind: "visualization", value: null },
        }),
        cmd("UpdateDashboardItem", {
          dashboardId,
          itemId: item.id,
          updates: { visualizationId },
        }),
      ],
    }).catch(() => toast.error("Couldn't switch the chart"));
  };

  const setDisplay = (display: DashboardItemDisplay) => {
    if (display === (item.display ?? "chart")) return;
    writeReport({
      commands: [
        cmd("UpdateDashboardItem", {
          dashboardId,
          itemId: item.id,
          updates: { display },
        }),
      ],
    }).catch(() => toast.error("Couldn't change what the item shows"));
  };

  const resetToSaved = () => {
    writeReport({
      commands: [
        cmd("PatchDashboardItemOverride", {
          dashboardId,
          itemId: item.id,
          patch: { kind: "visualization", value: null },
        }),
      ],
    }).catch(() => toast.error("Couldn't reset the chart"));
  };

  return (
    <>
      <div className="min-h-0 flex-1">
        <VisualizationConfigPanel
          activeChartType={effectiveVisualization.visualizationType}
          availableChartTypes={availableChartTypes}
          activeVisualization={effectiveVisualization}
          visualizations={insightVisualizations}
          compiledInsight={options.compiledInsight}
          dataTable={authoringTable}
          availableFields={options.availableFields}
          availableColumns={options.columns.map((column) => ({
            name: column.name,
            type: column.type ?? "unknown",
          }))}
          columnDisplayNames={options.columnDisplayNames}
          columnAnalysis={options.columnAnalysis}
          encodingsError={options.error}
          onRetryEncodings={options.retry}
          // A saved chart is always active here, so the panel never asks for
          // an unsaved suggestion.
          onSelectChartType={() => {}}
          onSelectVisualization={handleSelectVisualization}
          updateVisualization={updateVisualization}
          leadingSections={
            <ItemDisplaySection
              display={item.display ?? "chart"}
              onChange={setDisplay}
            />
          }
        />
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-neutral-border/60 px-3 pt-2.5 text-[11px] leading-4 text-neutral-fg-subtle">
        <p>
          {override
            ? "Changed on this report only. The saved chart is unchanged."
            : `Showing “${savedVisualization.name}” as saved. Changes here apply to this report only.`}
        </p>
        <div className="flex items-center gap-1.5">
          {override && (
            <Button
              size="sm"
              variant="outline"
              label="Reset to saved chart"
              onClick={resetToSaved}
            />
          )}
          <Link
            to="/insights/$insightId"
            params={{ insightId: insight.id }}
            search={{ reportId: dashboardId, visualize: false }}
            className="rounded-sm px-1 font-medium text-neutral-fg underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
          >
            Open insight
          </Link>
        </div>
      </div>
    </>
  );
}

const DISPLAY_LABELS: Record<DashboardItemDisplay, string> = {
  chart: "Chart",
  table: "Table",
  both: "Chart and table",
};

/** What the item shows readers: the chart, its data, or both. */
function ItemDisplaySection({
  display,
  onChange,
}: {
  display: DashboardItemDisplay;
  onChange: (display: DashboardItemDisplay) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <WorkbenchPaneSection
      title="Show"
      icon={PanelTop}
      open={open}
      summary={DISPLAY_LABELS[display]}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col gap-1.5 px-1.5">
        <Toggle
          variant="outline"
          size="sm"
          value={display}
          onValueChange={(value) => onChange(value as DashboardItemDisplay)}
          className="w-full [&>*]:flex-1"
          options={[
            {
              value: "chart",
              icon: <ChartIcon className="h-3.5 w-3.5" />,
              label: "Chart",
            },
            {
              value: "table",
              icon: <TableIcon className="h-3.5 w-3.5" />,
              label: "Table",
            },
            {
              value: "both",
              icon: <LayersIcon className="h-3.5 w-3.5" />,
              label: "Both",
            },
          ]}
        />
        {display === "both" && (
          <p className="text-[11px] leading-4 text-neutral-fg-subtle">
            The table shows once the item is tall enough for it.
          </p>
        )}
      </div>
    </WorkbenchPaneSection>
  );
}
