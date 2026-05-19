import { createFileRoute } from "@tanstack/react-router";
import DataSourcesPage from "../../../app/data-sources/page";

export const Route = createFileRoute("/data-sources/")({
  component: DataSourcesPage,
});
