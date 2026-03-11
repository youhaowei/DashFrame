import JoinConfigureContent from "@/app/insights/[insightId]/join/[tableId]/_components/JoinConfigureContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/insights/$insightId/join/$tableId")({
  component: JoinConfigurePage,
});

function JoinConfigurePage() {
  const { insightId, tableId } = Route.useParams();
  return <JoinConfigureContent insightId={insightId} tableId={tableId} />;
}
