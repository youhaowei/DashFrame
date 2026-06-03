import JoinConfigureContent from "@/app/insights/[insightId]/join/[tableId]/_components/JoinConfigureContent";
import { createFileRoute } from "@tanstack/react-router";

// Dot-notation file name keeps this a sibling of `$insightId.tsx` rather than
// nesting under it. The parent renders `InsightPageContent` without an
// `<Outlet />`, so a child route would silently never mount.
export const Route = createFileRoute("/insights/$insightId_/join/$tableId")({
  component: JoinConfigureRoute,
});

function JoinConfigureRoute() {
  const { insightId, tableId } = Route.useParams();
  return <JoinConfigureContent insightId={insightId} tableId={tableId} />;
}
