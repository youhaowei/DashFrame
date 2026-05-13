import { createFileRoute } from "@tanstack/react-router";
import JoinConfigureContent from "../../../../../app/insights/[insightId]/join/[tableId]/_components/JoinConfigureContent";

export const Route = createFileRoute("/insights/$insightId/join/$tableId")({
  component: JoinConfigureRoute,
});

function JoinConfigureRoute() {
  const { insightId, tableId } = Route.useParams();
  return <JoinConfigureContent insightId={insightId} tableId={tableId} />;
}
