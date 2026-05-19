import { createFileRoute } from "@tanstack/react-router";
import DataFramesPage from "../../app/data-frames/page";

export const Route = createFileRoute("/data-frames")({
  component: DataFramesPage,
});
