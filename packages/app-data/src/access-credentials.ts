import type {
  AccessCapabilities,
  AccessConnectionInfo,
  AccessCredential,
  AccessCredentialMutations,
  IssuedAccessCredential,
  UseAccessCapabilitiesResult,
  UseAccessConnectionInfoResult,
  UseAccessCredentialsResult,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";

export function useAccessConnectionInfo(): UseAccessConnectionInfoResult {
  const result = useQuery(api.getAccessConnectionInfo);
  return {
    data: result.data as AccessConnectionInfo | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useAccessCapabilities(): UseAccessCapabilitiesResult {
  const result = useQuery(api.getAccessCapabilities);
  return {
    data: result.data as AccessCapabilities | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useAccessCredentials(): UseAccessCredentialsResult {
  const result = useQuery(api.listAccessCredentials);
  return {
    data: result.data as AccessCredential[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    refetch: result.refetch,
  };
}

export function useAccessCredentialMutations(): AccessCredentialMutations {
  const issueMutation = useMutation(api.issueAccessCredential);
  const revokeMutation = useMutation(api.revokeAccessCredential);

  return useMemo(
    () => ({
      issue: async (name: string) =>
        (await issueMutation.mutateAsync({
          name,
        })) as IssuedAccessCredential,
      revoke: async (id) => {
        await revokeMutation.mutateAsync({ id });
      },
    }),
    [issueMutation, revokeMutation],
  );
}
