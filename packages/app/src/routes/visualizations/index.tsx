import VisualizationsPage from "@/app/visualizations/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/visualizations/")({
  component: VisualizationsPage,
});
