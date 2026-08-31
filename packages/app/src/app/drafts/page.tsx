import {
  DraftListItem,
  type DraftListEntry,
} from "@/components/drafts/DraftListItem";
import {
  DRAFT_DRIFT_DESCRIPTION,
  draftLifecycleErrorDescription,
  isDriftError,
} from "@/components/preview-diff/user-facing-errors";
import { api } from "@/wystack/api";
import { useMutation, useQuery } from "@wystack/client";
import { useState } from "react";
import {
  ArtifactCollection,
  ArtifactGrid,
  ArtifactEmptyState,
} from "@/components/artifacts/ArtifactCollection";
import { Button, ErrorState, Spinner } from "@wystack/ui-react";
import { toast } from "sonner";

export default function DraftsPage() {
  const {
    data: drafts = [],
    isLoading,
    isError,
    refetch,
  } = useQuery(api.listDrafts, { args: {} });
  const [searchQuery, setSearchQuery] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const filteredDrafts = drafts.filter((draft) =>
    `${draft.draftId} ${draft.commandCount} changes ${draft.paths.join(" ")}`
      .toLowerCase()
      .includes(query),
  );
  const { mutateAsync: discardDraft } = useMutation(api.discardDraft);

  const discard = async (draft: DraftListEntry) => {
    try {
      await discardDraft({ draftId: draft.draftId });
      toast.success("Draft discarded");
      await refetch();
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
      description={`${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}
      searchLabel="Search drafts"
      searchPlaceholder="Search drafts..."
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
          retryAction={{ label: "Retry", onClick: () => void refetch() }}
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
