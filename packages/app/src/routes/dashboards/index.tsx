import DashboardsPage from "@/app/dashboards/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboards/")({
  component: DashboardsPage,
});
