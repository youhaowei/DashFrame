import InsightPageContent from "@/app/insights/[insightId]/_components/InsightPageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/insights/$insightId")({
  component: InsightPage,
});

function InsightPage() {
  const { insightId } = Route.useParams();
  return <InsightPageContent insightId={insightId} />;
}
