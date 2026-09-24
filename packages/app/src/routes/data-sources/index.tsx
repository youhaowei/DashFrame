import DataSourcesPage from "@/app/data-sources/page";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

export const Route = createFileRoute("/data-sources/")({
  validateSearch: (search: Record<string, unknown>): { addSource?: true } => ({
    // The Add data source dialog is open; set by the command palette. Closing
    // the dialog drops it, so Back does not reopen it; a reload while it is
    // open keeps it open, like the other dialog and tab params.
    addSource: search.addSource === true ? true : undefined,
  }),
  component: DataSourcesRoute,
});

function DataSourcesRoute() {
  const { addSource } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setAddSourceOpen = useCallback(
    (open: boolean) =>
      navigate({
        search: { addSource: open ? true : undefined },
        // Opening or closing the dialog is not a page visit.
        replace: true,
      }),
    [navigate],
  );
  return (
    <DataSourcesPage
      addSourceOpen={addSource === true}
      onAddSourceOpenChange={setAddSourceOpen}
    />
  );
}
