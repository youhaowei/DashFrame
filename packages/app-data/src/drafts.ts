import type { PreviewDiff } from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";

export interface LateBoundOperandRef {
  commandIndex: number;
  path: string;
  jsonPath: string;
  kind: string;
  label?: string;
}

export interface DraftPublishReview {
  draftId: string;
  commands: Array<{ id?: string; path: string; args: unknown }>;
  diff: PreviewDiff;
  lateBound: LateBoundOperandRef[];
  publishBlocked: boolean;
}

export interface UseDraftPublishReviewResult {
  data: DraftPublishReview | undefined;
  isLoading: boolean;
}

export function useDraftPublishReview(
  draftId: string | undefined,
): UseDraftPublishReviewResult {
  const result = useQuery(api.draftPublishReview, {
    args: { draftId: draftId ?? "00000000-0000-0000-0000-000000000000" },
    skip: !draftId,
  });
  return {
    data: result.data as DraftPublishReview | undefined,
    isLoading: result.isLoading,
  };
}

export interface DraftMutations {
  publish: (draftId: string) => Promise<void>;
  discard: (draftId: string) => Promise<void>;
}

export function useDraftMutations(): DraftMutations {
  const publishMutation = useMutation(api.publishDraft);
  const discardMutation = useMutation(api.discardDraft);

  return useMemo(
    () => ({
      publish: async (draftId: string): Promise<void> => {
        await publishMutation.mutateAsync({ draftId });
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
