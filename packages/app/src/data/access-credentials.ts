import { useHostQuery, useHostMutation } from "@/data/host";
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

import { useMemo } from "react";

export function useAccessConnectionInfo(): UseAccessConnectionInfoResult {
  const result = useHostQuery("getAccessConnectionInfo");
  return {
    data: result.data as AccessConnectionInfo | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useAccessCapabilities(): UseAccessCapabilitiesResult {
  const result = useHostQuery("getAccessCapabilities");
  return {
    data: result.data as AccessCapabilities | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useAccessCredentials(): UseAccessCredentialsResult {
  const result = useHostQuery("listAccessCredentials");
  return {
    data: result.data as AccessCredential[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    refetch: result.refetch,
  };
}

export function useAccessCredentialMutations(): AccessCredentialMutations {
  const issueMutation = useHostMutation("issueAccessCredential");
  const revokeMutation = useHostMutation("revokeAccessCredential");

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
