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
import { ErrorState, Spinner } from "@wystack/ui-react";
import { toast } from "sonner";

export default function DraftsPage() {
  const {
    data: drafts = [],
    isLoading,
    isError,
    refetch,
  } = useQuery(api.listDrafts, { args: {} });
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
    <main className="h-full overflow-y-auto bg-surface-base p-[var(--surface-inset)]">
      <section className="mx-auto min-h-full max-w-4xl rounded-[var(--surface-radius)] bg-neutral-bg/90 px-6 py-8 shadow-[var(--surface-shadow)] saturate-[1.2]">
        <h1 className="text-xl font-semibold text-neutral-fg">Drafts</h1>

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

        {!isLoading && !isError && drafts.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-fg-subtle">
            No changes waiting for review.
          </p>
        ) : null}

        {!isLoading && !isError && drafts.length > 0 ? (
          <div className="mt-6 space-y-3">
            {drafts.map((draft) => (
              <DraftListItem
                key={draft.draftId}
                draft={draft}
                onDiscard={discard}
              />
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
