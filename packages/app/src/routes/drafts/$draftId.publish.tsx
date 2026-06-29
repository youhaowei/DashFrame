import DraftPublishPage from "@/app/drafts/[draftId]/publish/page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/drafts/$draftId/publish")({
  component: DraftPublishRoute,
});

function DraftPublishRoute() {
  const { draftId } = Route.useParams();
  return <DraftPublishPage draftId={draftId} />;
}
