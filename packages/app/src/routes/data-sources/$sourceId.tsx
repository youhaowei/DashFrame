import DataSourcePageContent from "@/app/data-sources/[sourceId]/_components/DataSourcePageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data-sources/$sourceId")({
  component: DataSourceRoute,
});

function DataSourceRoute() {
  const { sourceId } = Route.useParams();
  return <DataSourcePageContent sourceId={sourceId} />;
}
