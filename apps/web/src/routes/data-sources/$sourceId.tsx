import DataSourcePageContent from "@/app/data-sources/[sourceId]/_components/DataSourcePageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data-sources/$sourceId")({
  component: DataSourcePage,
});

function DataSourcePage() {
  const { sourceId } = Route.useParams();
  return <DataSourcePageContent sourceId={sourceId} />;
}
