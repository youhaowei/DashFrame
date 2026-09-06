import { useHostQuery } from "@/data/host";
import type {
  ConnectorCatalogEntry,
  UseConnectorCatalogResult,
} from "@dashframe/types";

export function useConnectorCatalog(): UseConnectorCatalogResult {
  const result = useHostQuery("getConnectorCatalog");
  return {
    data: result.data as ConnectorCatalogEntry[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
