import { createFileRoute } from "@tanstack/react-router";
import DashboardsPage from "../../../app/dashboards/page";

export const Route = createFileRoute("/dashboards/")({
  component: DashboardsPage,
});
