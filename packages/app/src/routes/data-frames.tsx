import DataFramesPage from "@/app/data-frames/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data-frames")({
  component: DataFramesPage,
});
