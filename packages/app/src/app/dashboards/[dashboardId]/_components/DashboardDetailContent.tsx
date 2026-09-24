import { ArtifactEmptyState } from "@/components/artifacts/ArtifactCollection";
import { ArtifactPageHeader } from "@/components/artifacts/ArtifactPageHeader";
import { DataPickerModal } from "@/components/data-sources/DataPickerModal";
import { useAppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { queryStatus } from "@/data/query-status";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { CHART_ICONS, type WorkbenchTabItem } from "@dashframe/ui";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { DashboardControlBar } from "@/components/dashboards/DashboardControlBar";
import { DashboardControlsManager } from "@/components/dashboards/DashboardControlsManager";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import { ReportChartTab } from "@/components/dashboards/ReportChartTab";
import { useTopBarTabs } from "@/components/shell/topbar-tabs";
import {
  resolveInsightAvailableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import {
  chartCreating,
  chartDiscards,
  disambiguateLabels,
  reconcileNewChartTab,
  reportBottom,
  resolveChartTabs,
  startNewChartTab,
  tabAfterClose,
  useChartWrites,
  useReportChartTabs,
  type ChartTab,
} from "@/lib/reports/chart-tabs";
import {
  indexReportContents,
  resolveReportContents,
} from "@/lib/reports/report-contents";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  type DashboardItemType,
  type InsightFilter,
  type UUID,
} from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
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
  DashboardIcon,
  EditIcon,
  FileIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface DashboardDetailContentProps {
  dashboardId: string;
  /** The chart tab open in the URL; the report itself when absent. */
  chartId?: string | null;
  /** Opens a chart tab, or the report with `null`. */
  onSelectChart?: (chartId: string | null) => void;
}

const REPORT_TAB_ID = "report";
const REPORT_PANEL_ID = "report-panel";
const NO_CHART_TABS: ChartTab[] = [];

export function formatReportContentsCount(
  questionCount: number,
  savedViewCount: number,
): string {
  return `${questionCount} question${questionCount === 1 ? "" : "s"} · ${savedViewCount} saved view${savedViewCount === 1 ? "" : "s"}`;
}

export default function DashboardDetailContent({
  dashboardId,
  chartId = null,
  onSelectChart,
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
  const { createChartInsight } = useCreateInsight();

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
  useAppBreadcrumbs(
    dashboard
      ? [
          { label: "Reports", to: "/dashboards" },
          { label: dashboard.name || "Untitled report" },
        ]
      : null,
  );

  // ── Chart tabs ───────────────────────────────────────────────────────────
  const storedChartTabs =
    useReportChartTabs((state) => state.tabsByReport[dashboardId]) ??
    NO_CHART_TABS;
  const openChartTab = useReportChartTabs((state) => state.open);
  const closeStoredChartTab = useReportChartTabs((state) => state.close);
  const setChartTabClosing = useReportChartTabs((state) => state.setClosing);
  const markChartCreated = useReportChartTabs((state) => state.created);
  const landChartTab = useReportChartTabs((state) => state.land);
  const chartWrites = useChartWrites();
  const chartIds = useMemo(
    () =>
      visualizationsLoading
        ? null
        : new Set(visualizations.map((visualization) => visualization.id)),
    [visualizations, visualizationsLoading],
  );
  // The tab just closed. Its id stays in the URL until navigation opens the
  // next tab; until then it must neither show nor count as a stale link.
  const [closedChartId, setClosedChartId] = useState<string | null>(null);
  // Once the URL has moved on, a later link to the closed chart opens it.
  if (closedChartId !== null && chartId !== closedChartId) {
    setClosedChartId(null);
  }
  const chartTabs = useMemo(
    () =>
      resolveChartTabs(
        storedChartTabs,
        chartId === closedChartId ? null : chartId,
        chartIds,
      ),
    [storedChartTabs, chartId, chartIds, closedChartId],
  );
  const activeChartTab = chartTabs.find((tab) => tab.id === chartId) ?? null;

  const selectChart = useCallback(
    (id: string | null) => onSelectChart?.(id),
    [onSelectChart],
  );

  // A chart opened by link joins the open tabs, so it stays open when the
  // report tab is selected. A link to a chart that is gone opens the report.
  useEffect(() => {
    if (!activeChartTab) return;
    if (storedChartTabs.some((tab) => tab.id === activeChartTab.id)) return;
    openChartTab(dashboardId, activeChartTab);
  }, [activeChartTab, dashboardId, openChartTab, storedChartTabs]);
  useEffect(() => {
    if (!chartId || !chartIds || activeChartTab) return;
    if (chartId === closedChartId) return;
    selectChart(null);
  }, [activeChartTab, chartId, chartIds, closedChartId, selectChart]);

  const editChart = useCallback(
    (visualizationId: string) => {
      setClosedChartId(null);
      openChartTab(dashboardId, { id: visualizationId });
      selectChart(visualizationId);
    },
    [dashboardId, openChartTab, selectChart],
  );

  // Closing a saved chart only takes its tab away. Closing a new chart also
  // discards the insight it was built on — but only once nothing about it is
  // in flight or unknown; the reconcile effect below finishes the close.
  const closeChartTab = useCallback(
    (tabId: string) => {
      const closing = chartTabs.find((tab) => tab.id === tabId);
      if (tabId === chartId) setClosedChartId(tabId);
      if (closing?.insightId) setChartTabClosing(dashboardId, tabId, true);
      else closeStoredChartTab(dashboardId, tabId);
      const next = tabAfterClose(chartTabs, tabId, chartId);
      if (next !== chartId) selectChart(next);
    },
    [
      chartId,
      chartTabs,
      closeStoredChartTab,
      dashboardId,
      selectChart,
      setChartTabClosing,
    ],
  );

  // Brings each new chart's tab in line with what the server has: a create
  // that finished or never happened, a landing a reload interrupted, a close
  // waiting to discard. Decides nothing from a list that has not loaded.
  useEffect(() => {
    // A failed query is not an empty one: it decides nothing either.
    const insightIds =
      insightsLoading || insightsLoadError
        ? null
        : new Set(insights.map((insight) => insight.id));
    const loadedVisualizations =
      visualizationsLoading || visualizationsLoadError ? null : visualizations;
    for (const tab of storedChartTabs) {
      const step = reconcileNewChartTab(tab, {
        insightIds,
        visualizations: loadedVisualizations,
        creating: chartWrites.creating.has(tab.id),
        landing: chartWrites.landing.has(tab.id),
      });
      if (step === "created") {
        // Created once the insight is listed, so the tab never shows a
        // chart it cannot find yet.
        markChartCreated(dashboardId, tab.id);
        chartCreating.finish(tab.id);
      }
      if (step === "landed") landChartTab(dashboardId, tab.id);
      if (step === "remove") closeStoredChartTab(dashboardId, tab.id);
      if (step !== "discard" || chartDiscards.has(tab.id)) continue;
      chartDiscards.add(tab.id);
      commitBatch({
        commands: [cmd("DeleteNode", { id: tab.insightId as UUID })],
      })
        .then(() => closeStoredChartTab(dashboardId, tab.id))
        .catch((error: unknown) => {
          console.error("Failed to discard the new chart", error);
          // Keep the chart: its tab comes back so nothing is left unowned.
          setChartTabClosing(dashboardId, tab.id, false);
          toast.error("Couldn't discard the new chart", {
            action: {
              label: "Try again",
              onClick: () => setChartTabClosing(dashboardId, tab.id, true),
            },
          });
        })
        .finally(() => chartDiscards.delete(tab.id));
    }
  }, [
    chartWrites,
    closeStoredChartTab,
    commitBatch,
    dashboardId,
    insights,
    insightsLoadError,
    insightsLoading,
    landChartTab,
    markChartCreated,
    setChartTabClosing,
    storedChartTabs,
    visualizations,
    visualizationsLoadError,
    visualizationsLoading,
  ]);

  const handleChartLanded = useCallback(
    (tabId: string) => landChartTab(dashboardId, tabId),
    [dashboardId, landChartTab],
  );

  const [isChartPickerOpen, setIsChartPickerOpen] = useState(false);
  // A double click on a table must start one chart, not two.
  const startingChartRef = useRef(false);
  const startNewChart = async (tableId: string, tableName: string) => {
    if (startingChartRef.current) return null;
    startingChartRef.current = true;
    const tabId = await startNewChartTab(dashboardId, (insightId) =>
      createChartInsight(tableId, tableName, insightId),
    ).finally(() => {
      startingChartRef.current = false;
    });
    if (!tabId) return null;
    setIsChartPickerOpen(false);
    // Closed while it was being created: the reconcile effect discards it.
    const stillOpen = (
      useReportChartTabs.getState().tabsByReport[dashboardId] ?? []
    ).some((tab) => tab.id === tabId && !tab.closing);
    if (stillOpen) selectChart(tabId);
    return tabId;
  };

  const visualizationById = useMemo(
    () =>
      new Map(
        visualizations.map((visualization) => [
          visualization.id,
          visualization,
        ]),
      ),
    [visualizations],
  );
  const topBarTabItems = useMemo<WorkbenchTabItem[]>(() => {
    const labels = disambiguateLabels(
      chartTabs.map(
        (tab) => visualizationById.get(tab.id)?.name || "Untitled chart",
      ),
    );
    return [
      {
        id: REPORT_TAB_ID,
        label: dashboard?.name || "Untitled report",
        icon: <DashboardIcon className="size-3.5" />,
        pinned: "start",
      },
      ...chartTabs.map((tab, index): WorkbenchTabItem => {
        const visualization = visualizationById.get(tab.id);
        const Icon = visualization
          ? CHART_ICONS[visualization.visualizationType]
          : ChartIcon;
        return {
          id: tab.id,
          label: labels[index]!,
          icon: <Icon className="size-3.5" />,
          closable: true,
          unsaved: tab.insightId !== undefined,
        };
      }),
    ];
  }, [chartTabs, dashboard?.name, visualizationById]);
  const activeTabId = activeChartTab?.id ?? REPORT_TAB_ID;
  const topBarTabs = useMemo(
    () =>
      dashboard
        ? {
            label: "Report and its charts",
            tabs: topBarTabItems,
            activeId: activeTabId,
            onSelect: (id: string) =>
              selectChart(id === REPORT_TAB_ID ? null : id),
            onClose: closeChartTab,
            panelId: REPORT_PANEL_ID,
            findLabel: "Find a chart",
            findEmptyLabel: "No matching charts.",
          }
        : null,
    [activeTabId, closeChartTab, dashboard, selectChart, topBarTabItems],
  );
  useTopBarTabs(topBarTabs);

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
  const [isSavedViewOpen, setIsSavedViewOpen] = useState(false);
  const [isAddPending, setIsAddPending] = useState(false);
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

  if (dashboardsLoadError || visualizationsLoadError || insightsLoadError) {
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

  const addItem = async (
    type: DashboardItemType,
    visualizationId?: string,
  ): Promise<boolean> => {
    setIsAddPending(true);
    try {
      await commitBatch({
        commands: [
          cmd("AddDashboardItem", {
            dashboardId: dashboardId as UUID,
            item: {
              id: crypto.randomUUID() as UUID,
              type,
              x: 0,
              // Below every tile. Infinity would serialize to null and fail
              // the server's position validator.
              y: reportBottom(dashboard.items),
              width: type === "visualization" ? 6 : 4,
              height: type === "visualization" ? 6 : 4,
              visualizationId:
                type === "visualization"
                  ? (visualizationId as UUID)
                  : undefined,
              content:
                type === "markdown"
                  ? "## New Text Widget\n\nEdit this text..."
                  : undefined,
            },
          }),
        ],
      });
      return true;
    } catch (error) {
      console.error("Failed to add report item", error);
      toast.error("Couldn't add report item");
      return false;
    } finally {
      setIsAddPending(false);
    }
  };

  const handleAddSavedView = async () => {
    // Keep the dialog open on failure so the user's selection isn't lost.
    if (!(await addItem("visualization", selectedVizId))) return;
    setIsSavedViewOpen(false);
    setSelectedVizId("");
  };

  const handleSaveControls = async (
    controls: NonNullable<typeof dashboard.controls>,
  ) => {
    await commitBatch({
      commands: [
        cmd("SetDashboardControls", {
          dashboardId: dashboardId as UUID,
          controls,
        }),
      ],
    });
  };

  const chartPicker = (
    <DataPickerModal
      isOpen={isChartPickerOpen}
      onClose={() => setIsChartPickerOpen(false)}
      title="New chart"
      onTableSelect={startNewChart}
    />
  );

  if (activeChartTab) {
    return (
      <div
        id={REPORT_PANEL_ID}
        role="tabpanel"
        aria-label="Chart"
        className="h-full"
      >
        <ReportChartTab
          key={activeChartTab.id}
          report={dashboard}
          tab={activeChartTab}
          reports={dashboards}
          visualizations={visualizations}
          insights={insights}
          insightsLoaded={!insightsLoading}
          dataTables={dataTables}
          onLanded={handleChartLanded}
        />
      </div>
    );
  }

  return (
    <div
      id={REPORT_PANEL_ID}
      role="tabpanel"
      aria-label="Report"
      className="flex h-full flex-col"
    >
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
            {isEditable && questionMetadataAvailable && (
              <DashboardControlsManager
                controls={dashboard.controls ?? []}
                items={dashboard.items}
                visualizations={visualizations}
                insights={insights}
                dataTables={dataTables}
                onSave={handleSaveControls}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button color="secondary" icon={PlusIcon} label="Add item" />
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsChartPickerOpen(true)}>
                  <ChartIcon className="mr-2 h-4 w-4" />
                  Chart
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsSavedViewOpen(true)}>
                  <ChartIcon className="mr-2 h-4 w-4" />
                  Saved view
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isAddPending}
                  onClick={() => void addItem("markdown")}
                >
                  <FileIcon className="mr-2 h-4 w-4" />
                  Text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/* The report is the grid. An empty report is one invitation, not a
          set of zero counts. */}
      <div className="flex-1 overflow-y-auto bg-neutral-bg-muted/10 p-6">
        {dashboard.items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <ArtifactEmptyState
              title="Put something on this report"
              description="Build a chart from your data, or add a view you already saved."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    label="Add a chart"
                    icon={PlusIcon}
                    onClick={() => setIsChartPickerOpen(true)}
                  />
                  <Button
                    variant="outline"
                    label="Add a saved view"
                    onClick={() => setIsSavedViewOpen(true)}
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
            onEditChart={editChart}
          />
        )}
      </div>

      {chartPicker}

      <Dialog open={isSavedViewOpen} onOpenChange={setIsSavedViewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a saved view</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label>Saved view</Label>
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
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              label="Cancel"
              onClick={() => setIsSavedViewOpen(false)}
            />
            <Button
              label="Add item"
              onClick={handleAddSavedView}
              disabled={isAddPending || !selectedVizId}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
