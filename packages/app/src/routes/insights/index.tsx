import InsightsPage from "@/app/insights/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/insights/")({
  component: InsightsPage,
});
