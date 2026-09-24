import DraftsPageContent from "@/app/drafts/_components/DraftsPageContent";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/drafts/$draftId/")({
  component: DraftRoute,
});

function DraftRoute() {
  const { draftId } = Route.useParams();
  return <DraftsPageContent draftId={draftId} />;
}
