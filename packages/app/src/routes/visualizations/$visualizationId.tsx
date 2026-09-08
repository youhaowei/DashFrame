import VisualizationPageContent from "@/app/visualizations/[visualizationId]/_components/VisualizationPageContent";
import { createFileRoute } from "@tanstack/react-router";

export function validateVisualizationSearch(search: Record<string, unknown>) {
  return {
    reportId:
      typeof search.reportId === "string" && search.reportId.trim()
        ? search.reportId
        : undefined,
  };
}

export const Route = createFileRoute("/visualizations/$visualizationId")({
  validateSearch: validateVisualizationSearch,
  component: VisualizationRoute,
});

function VisualizationRoute() {
  const { visualizationId } = Route.useParams();
  const { reportId } = Route.useSearch();
  return (
    <VisualizationPageContent
      visualizationId={visualizationId}
      reportId={reportId}
    />
  );
}
