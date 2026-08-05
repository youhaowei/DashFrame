import DraftsPage from "@/app/drafts/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/drafts/")({
  component: DraftsPage,
});
