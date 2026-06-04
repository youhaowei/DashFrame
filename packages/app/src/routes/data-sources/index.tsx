import DataSourcesPage from "@/app/data-sources/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data-sources/")({
  component: DataSourcesPage,
});
