import type {
  HarnessAccessCredential,
  HarnessAccessMutations,
  HarnessConnectionInfo,
  IssuedHarnessAccessCredential,
  UseHarnessAccessCredentialsResult,
  UseHarnessConnectionInfoResult,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";

export function useHarnessConnectionInfo(): UseHarnessConnectionInfoResult {
  const result = useQuery(api.getHarnessConnectionInfo);
  return {
    data: result.data as HarnessConnectionInfo | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useHarnessAccessCredentials(): UseHarnessAccessCredentialsResult {
  const result = useQuery(api.listHarnessAccessCredentials);
  return {
    data: result.data as HarnessAccessCredential[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useHarnessAccessMutations(): HarnessAccessMutations {
  const issueMutation = useMutation(api.issueHarnessAccessCredential);
  const revokeMutation = useMutation(api.revokeHarnessAccessCredential);

  return useMemo(
    () => ({
      issue: async (name: string) =>
        (await issueMutation.mutateAsync({
          name,
        })) as IssuedHarnessAccessCredential,
      revoke: async (id) => {
        await revokeMutation.mutateAsync({ id });
      },
    }),
    [issueMutation, revokeMutation],
  );
}
