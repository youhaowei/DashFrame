import type {
  ConnectorCatalogEntry,
  UseConnectorCatalogResult,
} from "@dashframe/types";
import { useQuery } from "@wystack/client";

import { api } from "../wystack/api";

export function useConnectorCatalog(): UseConnectorCatalogResult {
  const result = useQuery(api.getConnectorCatalog);
  return {
    data: result.data as ConnectorCatalogEntry[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
