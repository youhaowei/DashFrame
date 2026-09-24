import type { ReportTarget } from "@/components/dashboards/ReportPickerDialog";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { reportBottom, startNewChartTab } from "@/lib/reports/chart-tabs";
import { api } from "@dashframe/convex-backend/api";
import { cmd, type Dashboard, type UUID } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

const NEW_REPORT_NAME = "Untitled report";

/**
 * The ways into a chart from outside a report. A chart is edited inside a
 * report, so each one lands on a report with the chart's tab open:
 *
 * - `startChart` — a new chart on a table: the report (a new one when asked)
 *   opens with a new chart tab on that table.
 * - `openChart` — a saved chart: placed on the report as a tile when it is
 *   not there yet, then opened as a tab.
 *
 * Both resolve once the report is open, and to `false` when they could not
 * get there (already reported with a toast). While one is on its way, another
 * call resolves to `false` at once, so a double click starts one chart.
 */
export function useOpenChartInReport() {
  const navigate = useNavigate();
  const commitBatch = useMutation(api.app.commitBatch);
  const { createChartInsight } = useCreateInsight();
  // The reports as they are now: a report offered in a picker may have been
  // deleted since, and a chart started on it would be left on no report.
  const { data: currentReports } = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );
  // `false` from a call it skipped means "another start is in flight", not
  // a failure: nothing is shown, since the first call reports its own outcome.
  const inFlight = useRef(false);
  const once = useCallback(async (run: () => Promise<boolean>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      return await run();
    } finally {
      inFlight.current = false;
    }
  }, []);

  const openReport = useCallback(
    (reportId: string, chartId: string) =>
      navigate({
        to: `/dashboards/${reportId}`,
        search: { chart: chartId },
      } as never),
    [navigate],
  );

  const startChart = useCallback(
    (target: ReportTarget, table: { id: string; name: string }) =>
      once(async () => {
        if (
          target.kind === "existing" &&
          !currentReports?.some((report) => report.id === target.reportId)
        ) {
          toast.error("That report no longer exists. Pick another one.");
          return false;
        }
        const reportId =
          target.kind === "existing" ? target.reportId : crypto.randomUUID();
        if (target.kind === "new") {
          try {
            await commitBatch({
              commands: [
                cmd("CreateDashboard", {
                  id: reportId as UUID,
                  name: NEW_REPORT_NAME,
                }),
              ],
            });
          } catch {
            toast.error("Couldn't start a report");
            return false;
          }
        }
        const tabId = await startNewChartTab(reportId, (insightId) =>
          createChartInsight(table.id, table.name, insightId),
        );
        if (!tabId) {
          // The chart could not start (already reported); a report made just
          // for it goes too.
          if (target.kind === "new") {
            await commitBatch({
              commands: [cmd("DeleteNode", { id: reportId as UUID })],
            }).catch(() => {});
          }
          return false;
        }
        await openReport(reportId, tabId);
        return true;
      }),
    [commitBatch, createChartInsight, currentReports, once, openReport],
  );

  const openChart = useCallback(
    (
      target: ReportTarget,
      visualizationId: string,
      reports: readonly Pick<Dashboard, "id" | "items">[],
    ) =>
      once(async () => {
        const existing =
          target.kind === "existing"
            ? reports.find((report) => report.id === target.reportId)
            : undefined;
        if (target.kind === "existing" && !existing) {
          // The report went away after it was offered.
          toast.error("That report no longer exists. Pick another one.");
          return false;
        }
        const onReport = existing?.items.some(
          (item) =>
            item.type === "visualization" &&
            item.visualizationId === visualizationId,
        );
        const reportId = existing?.id ?? crypto.randomUUID();
        if (!onReport) {
          try {
            await commitBatch({
              commands: [
                ...(existing
                  ? []
                  : [
                      cmd("CreateDashboard", {
                        id: reportId as UUID,
                        name: NEW_REPORT_NAME,
                      }),
                    ]),
                cmd("AddDashboardItem", {
                  dashboardId: reportId as UUID,
                  item: {
                    id: crypto.randomUUID() as UUID,
                    type: "visualization",
                    visualizationId: visualizationId as UUID,
                    x: 0,
                    y: reportBottom(existing?.items ?? []),
                    width: 6,
                    height: 6,
                  },
                }),
              ],
            });
          } catch {
            toast.error("Couldn't place the chart on the report");
            return false;
          }
        }
        await openReport(reportId, visualizationId);
        return true;
      }),
    [commitBatch, once, openReport],
  );

  return { startChart, openChart };
}
