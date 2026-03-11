import DashboardDetailContent from "@/app/dashboards/[dashboardId]/_components/DashboardDetailContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboards/$dashboardId")({
  component: DashboardDetailPage,
});

function DashboardDetailPage() {
  const { dashboardId } = Route.useParams();
  return <DashboardDetailContent dashboardId={dashboardId} />;
}
