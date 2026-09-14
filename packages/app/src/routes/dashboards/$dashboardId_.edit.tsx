import DashboardDetailContent from "@/app/dashboards/[dashboardId]/_components/DashboardDetailContent";
import { ReportDraftProvider } from "@/components/dashboards/report-write";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

export function validateReportEditSearch(search: Record<string, unknown>): {
  draft?: string;
} {
  return typeof search.draft === "string" && search.draft.trim()
    ? { draft: search.draft }
    : {};
}

// The trailing underscore keeps this a sibling of `$dashboardId.tsx` rather
// than nesting under it. The view page renders no `<Outlet />`, so a child
// route would never mount.
export const Route = createFileRoute("/dashboards/$dashboardId_/edit")({
  validateSearch: validateReportEditSearch,
  component: DashboardEditRoute,
});

function DashboardEditRoute() {
  const { dashboardId } = Route.useParams();
  const { draft } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The first edit creates the draft; keeping its id in the URL lets a reload
  // or a shared link resume the same draft.
  const handleDraftCreated = useCallback(
    (draftId: string) => {
      void navigate({ search: { draft: draftId }, replace: true });
    },
    [navigate],
  );

  return (
    <ReportDraftProvider draftId={draft} onDraftCreated={handleDraftCreated}>
      <DashboardDetailContent
        dashboardId={dashboardId}
        mode="edit"
        draftId={draft}
      />
    </ReportDraftProvider>
  );
}
