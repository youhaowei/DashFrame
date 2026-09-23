import DataSourcePageContent from "@/app/data-sources/[sourceId]/_components/DataSourcePageContent";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

export const Route = createFileRoute("/data-sources/$sourceId")({
  validateSearch: (search: Record<string, unknown>) => ({
    // The open table tab, so a reload or a shared link reopens it.
    table:
      typeof search.table === "string" && search.table.trim()
        ? search.table
        : undefined,
  }),
  component: DataSourceRoute,
});

function DataSourceRoute() {
  const { sourceId } = Route.useParams();
  const { table } = Route.useSearch();
  const navigate = Route.useNavigate();
  const selectTable = useCallback(
    (tableId: string | null) =>
      navigate({
        search: { table: tableId ?? undefined },
        // Switching tabs is not a page visit; Back leaves the source.
        replace: true,
      }),
    [navigate],
  );
  return (
    <DataSourcePageContent
      sourceId={sourceId}
      tableId={table ?? null}
      onSelectTable={selectTable}
    />
  );
}
