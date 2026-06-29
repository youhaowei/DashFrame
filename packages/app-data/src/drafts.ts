import type { UseQueryResult } from "@tanstack/react-query";
import type { RefReturn } from "@wystack/client";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

// Derive review types directly from the server RPC contract (via the typed api)
// so the client shape cannot drift or mask the real return type. This eliminates
// the local narrowed re-declaration and any implicit cast.
export type DraftPublishReview = RefReturn<typeof api.draftPublishReview>;
export type LateBoundOperandRef = DraftPublishReview["lateBound"][number];
export type DraftCommandSummary = DraftPublishReview["commands"][number];

export type UseDraftPublishReviewResult = UseQueryResult<DraftPublishReview>;

export function useDraftPublishReview(
  draftId: string | undefined,
): UseDraftPublishReviewResult {
  return useQuery(api.draftPublishReview, {
    args: { draftId: draftId ?? "00000000-0000-0000-0000-000000000000" },
    skip: !draftId,
  });
}

export interface DraftMutations {
  publish: (
    draftId: string,
    options?: { expectedCommandCount?: number },
  ) => Promise<void>;
  discard: (draftId: string) => Promise<void>;
}

export function useDraftMutations(): DraftMutations {
  const publishMutation = useMutation(api.publishDraft);
  const discardMutation = useMutation(api.discardDraft);

  return useMemo(
    () => ({
      publish: async (
        draftId: string,
        options?: { expectedCommandCount?: number },
      ): Promise<void> => {
        await publishMutation.mutateAsync(
          loose({
            draftId,
            expectedCommandCount:
              options?.expectedCommandCount !== undefined
                ? String(options.expectedCommandCount)
                : undefined,
          }),
        );
      },
      discard: async (draftId: string): Promise<void> => {
        await discardMutation.mutateAsync({ draftId });
      },
    }),
    [discardMutation, publishMutation],
  );
}

export async function getDraftPublishReview(
  draftId: string,
): Promise<DraftPublishReview> {
  return getWyStackClient().query(api.draftPublishReview, { draftId });
}
