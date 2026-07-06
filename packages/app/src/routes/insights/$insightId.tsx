import InsightPageContent from "@/app/insights/[insightId]/_components/InsightPageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/insights/$insightId")({
  validateSearch: (search: Record<string, unknown>) => ({
    // The router's default search parser JSON-parses values, so
    // `?visualize=true` arrives as boolean true — accept both forms.
    visualize: search.visualize === true || search.visualize === "true",
  }),
  component: InsightRoute,
});

function InsightRoute() {
  const { insightId } = Route.useParams();
  const { visualize } = Route.useSearch();
  return (
    <InsightPageContent insightId={insightId} visualizeIntent={visualize} />
  );
}
