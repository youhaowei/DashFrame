import type {
  AssistantProviderCatalogEntry,
  AssistantProviderConfig,
  AssistantProviderConfigMutations,
  SaveAssistantProviderConfigInput,
  UseAssistantProviderCatalogResult,
  UseAssistantProviderConfigsResult,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "../wystack/api";

export function useAssistantProviderCatalog(): UseAssistantProviderCatalogResult {
  const result = useQuery(api.listAssistantProviderCatalog);
  return {
    data: result.data as AssistantProviderCatalogEntry[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useAssistantProviderConfigs(): UseAssistantProviderConfigsResult {
  const result = useQuery(api.listAssistantProviderConfigs);
  return {
    data: result.data as AssistantProviderConfig[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

export function useAssistantProviderConfigMutations(): AssistantProviderConfigMutations {
  const saveMutation = useMutation(api.saveAssistantProviderConfig);
  const removeMutation = useMutation(api.removeAssistantProviderConfig);
  const setDefaultModelMutation = useMutation(api.setAssistantDefaultModel);
  const startOAuthLoginMutation = useMutation(api.startAssistantOAuthLogin);

  return useMemo(
    () => ({
      save: async (input: SaveAssistantProviderConfigInput) =>
        (await saveMutation.mutateAsync({ input })) as AssistantProviderConfig,
      remove: async (id) => {
        await removeMutation.mutateAsync({ id });
      },
      setDefaultModel: async (input) => {
        await setDefaultModelMutation.mutateAsync({ input });
      },
      startOAuthLogin: async (id) => {
        await startOAuthLoginMutation.mutateAsync({ id });
      },
    }),
    [
      removeMutation,
      saveMutation,
      setDefaultModelMutation,
      startOAuthLoginMutation,
    ],
  );
}
