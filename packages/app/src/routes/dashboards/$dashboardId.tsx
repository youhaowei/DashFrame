import DashboardDetailContent from "@/app/dashboards/[dashboardId]/_components/DashboardDetailContent";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

export const Route = createFileRoute("/dashboards/$dashboardId")({
  validateSearch: (search: Record<string, unknown>) => ({
    // The open chart tab, so a reload or a shared link reopens it.
    chart:
      typeof search.chart === "string" && search.chart.trim()
        ? search.chart
        : undefined,
  }),
  component: DashboardDetailRoute,
});

function DashboardDetailRoute() {
  const { dashboardId } = Route.useParams();
  const { chart } = Route.useSearch();
  const navigate = Route.useNavigate();
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
    />
  );
}
