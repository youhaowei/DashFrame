import DraftReviewPage from "@/app/drafts/[draftId]/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/drafts/$draftId/")({
  component: DraftReviewRoute,
});

function DraftReviewRoute() {
  const { draftId } = Route.useParams();
  return <DraftReviewPage draftId={draftId} />;
}
