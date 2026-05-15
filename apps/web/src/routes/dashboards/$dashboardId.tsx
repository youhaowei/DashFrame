import { createFileRoute } from "@tanstack/react-router";
import DashboardDetailContent from "../../../app/dashboards/[dashboardId]/_components/DashboardDetailContent";

export const Route = createFileRoute("/dashboards/$dashboardId")({
  component: DashboardDetailRoute,
});

function DashboardDetailRoute() {
  const { dashboardId } = Route.useParams();
  return <DashboardDetailContent dashboardId={dashboardId} />;
}
