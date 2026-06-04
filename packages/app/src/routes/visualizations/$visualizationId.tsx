import VisualizationPageContent from "@/app/visualizations/[visualizationId]/_components/VisualizationPageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/visualizations/$visualizationId")({
  component: VisualizationRoute,
});

function VisualizationRoute() {
  const { visualizationId } = Route.useParams();
  return <VisualizationPageContent visualizationId={visualizationId} />;
}
