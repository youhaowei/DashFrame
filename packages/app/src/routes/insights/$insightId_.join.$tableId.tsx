import JoinConfigureContent from "@/app/insights/[insightId]/join/[tableId]/_components/JoinConfigureContent";
import { createFileRoute } from "@tanstack/react-router";

export function validateJoinSearch(search: Record<string, unknown>) {
  return {
    reportId:
      typeof search.reportId === "string" && search.reportId.trim()
        ? search.reportId
        : undefined,
  };
}

// Dot-notation file name keeps this a sibling of `$insightId.tsx` rather than
// nesting under it. The parent renders `InsightPageContent` without an
// `<Outlet />`, so a child route would silently never mount.
export const Route = createFileRoute("/insights/$insightId_/join/$tableId")({
  validateSearch: validateJoinSearch,
  component: JoinConfigureRoute,
});

function JoinConfigureRoute() {
  const { insightId, tableId } = Route.useParams();
  const { reportId } = Route.useSearch();
  return (
    <JoinConfigureContent
      insightId={insightId}
      tableId={tableId}
      reportId={reportId}
    />
  );
}
