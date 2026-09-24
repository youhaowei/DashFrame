import DashboardDetailContent from "@/app/dashboards/[dashboardId]/_components/DashboardDetailContent";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

export const Route = createFileRoute("/dashboards/$dashboardId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { chart?: string; pickChart?: true } => ({
    // The open chart tab, so a reload or a shared link reopens it.
    chart:
      typeof search.chart === "string" && search.chart.trim()
        ? search.chart
        : undefined,
    // Set once, by creating a project's first report: open it on the chart
    // picker. Dropped on arrival so a reload or Back does not reopen it.
    pickChart: search.pickChart === true ? true : undefined,
  }),
  component: DashboardDetailRoute,
});

function DashboardDetailRoute() {
  const { dashboardId } = Route.useParams();
  const { chart, pickChart } = Route.useSearch();
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (pickChart) {
      void navigate({ search: { chart }, replace: true });
    }
  }, [pickChart, chart, navigate]);
  const selectChart = useCallback(
    (chartId: string | null) =>
      navigate({
        search: { chart: chartId ?? undefined },
        // Switching tabs is not a page visit; Back leaves the report.
        replace: true,
      }),
    [navigate],
  );
  return (
    <DashboardDetailContent
      dashboardId={dashboardId}
      chartId={chart ?? null}
      onSelectChart={selectChart}
      // Read once, on mount; the effect above drops it from the URL.
      openChartPicker={pickChart === true}
    />
  );
}
