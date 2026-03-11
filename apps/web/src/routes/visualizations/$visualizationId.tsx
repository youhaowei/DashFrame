import VisualizationPageContent from "@/app/visualizations/[visualizationId]/_components/VisualizationPageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/visualizations/$visualizationId")({
  component: VisualizationPage,
});

function VisualizationPage() {
  const { visualizationId } = Route.useParams();
  return <VisualizationPageContent visualizationId={visualizationId} />;
}
