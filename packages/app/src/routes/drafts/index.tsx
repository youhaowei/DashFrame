import DraftsPageContent from "@/app/drafts/_components/DraftsPageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/drafts/")({
  component: DraftsRoute,
});

/** Opens the most recent draft without naming it in the URL. */
function DraftsRoute() {
  return <DraftsPageContent draftId={null} />;
}
