import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import {
  DraftListItem,
  type DraftListEntry,
} from "@/components/drafts/DraftListItem";
import {
  DRAFT_DRIFT_DESCRIPTION,
  draftLifecycleErrorDescription,
  isDriftError,
} from "@/components/preview-diff/user-facing-errors";
import { useState } from "react";
import {
  ArtifactCollection,
  ArtifactGrid,
  ArtifactEmptyState,
} from "@/components/artifacts/ArtifactCollection";
import { Button, ErrorState, Spinner } from "@wystack/ui-react";
import { api } from "@dashframe/convex-backend/api";
import { toast } from "sonner";

function getDraftCountPresentation(
  isLoading: boolean,
  isError: boolean,
  count: number,
) {
  if (isLoading || isError)
    return { description: undefined, itemCount: undefined };
  return {
    description: `${count} draft${count === 1 ? "" : "s"}`,
    itemCount: count,
  };
}

export default function DraftsPage() {
  const {
    data: drafts = [],
    isLoading,
    isError,
  } = queryStatus(useQuery({ query: api.app.listDrafts, args: {} }));
  const [searchQuery, setSearchQuery] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const filteredDrafts = drafts.filter((draft) =>
    `${draft.draftId} ${draft.commandCount} changes ${draft.paths.join(" ")}`
      .toLowerCase()
      .includes(query),
  );
  const discardDraft = useMutation(api.app.discardDraft);
  const draftCount = getDraftCountPresentation(
    isLoading,
    isError,
    drafts.length,
  );

  const discard = async (draft: DraftListEntry) => {
    try {
      await discardDraft({ draftId: draft.draftId });
      toast.success("Draft discarded");
    } catch (error) {
      toast.error("Failed to discard draft", {
        description: isDriftError(error)
          ? DRAFT_DRIFT_DESCRIPTION
          : draftLifecycleErrorDescription(error),
      });
    }
  };

  return (
    <ArtifactCollection
      title="Drafts"
      description={draftCount.description}
      searchLabel="Search drafts"
      searchPlaceholder="Search drafts..."
      itemCount={draftCount.itemCount}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      {isLoading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner size="lg" className="text-neutral-fg-subtle" />
        </div>
      ) : null}

      {!isLoading && isError ? (
        <ErrorState
          title="Failed to load review"
          description="Could not load this draft review. Please try again."
          retryAction={{
            label: "Retry",
            onClick: () => globalThis.location.reload(),
          }}
          className="min-h-40"
        />
      ) : null}

      {!isLoading && !isError && filteredDrafts.length === 0 ? (
        <ArtifactEmptyState
          title={query ? "No drafts found" : "No changes waiting for review"}
          description={
            query
              ? `No drafts match "${searchQuery}"`
              : "Draft changes will appear here for review."
          }
          action={
            query ? (
              <Button
                variant="outline"
                label="Clear search"
                onClick={() => setSearchQuery("")}
              />
            ) : undefined
          }
        />
      ) : null}

      {!isLoading && !isError && filteredDrafts.length > 0 ? (
        <ArtifactGrid>
          {filteredDrafts.map((draft) => (
            <DraftListItem
              key={draft.draftId}
              draft={draft}
              onDiscard={discard}
            />
          ))}
        </ArtifactGrid>
      ) : null}
    </ArtifactCollection>
  );
}
