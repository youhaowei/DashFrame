import JoinConfigureContent from "@/app/dashboards/[dashboardId]/join/_components/JoinConfigureContent";
import { createFileRoute } from "@tanstack/react-router";

export function validateJoinSearch(search: Record<string, unknown>) {
  return {
    chart:
      typeof search.chart === "string" && search.chart.trim()
        ? search.chart
        : undefined,
  };
}

// `$dashboardId_` keeps this a sibling of the report route rather than nesting
// under it: the report renders no `<Outlet />`, so a child would never mount.
export const Route = createFileRoute(
  "/dashboards/$dashboardId_/join/$insightId/$tableId",
)({
  validateSearch: validateJoinSearch,
  component: JoinConfigureRoute,
});

function JoinConfigureRoute() {
  const { dashboardId, insightId, tableId } = Route.useParams();
  const { chart } = Route.useSearch();
  return (
    <JoinConfigureContent
      reportId={dashboardId}
      insightId={insightId}
      tableId={tableId}
      chartId={chart}
    />
  );
}
