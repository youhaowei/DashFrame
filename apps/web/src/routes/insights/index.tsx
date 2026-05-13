import { createFileRoute } from "@tanstack/react-router";
import InsightsPage from "../../../app/insights/page";

export const Route = createFileRoute("/insights/")({
  component: InsightsPage,
});
