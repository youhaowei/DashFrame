import { useEffect, useState } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useStoresHydrated } from "@/hooks/useStoresHydrated";

/**
 * Hydrates local Zustand stores with localStorage data.
 *
 * Handles the SSR hydration pattern where stores are empty during
 * server-side rendering and need to be rehydrated on the client.
 *
 * @example
 * ```tsx
 * const { isHydrated, localSources } = useLocalStoreHydration();
 *
 * if (!isHydrated) {
 *   return <LoadingSpinner />;
 * }
 *
 * return <div>{localSources.length} sources loaded</div>;
 * ```
 */
export function useLocalStoreHydration() {
  const isHydrated = useStoresHydrated(
    useDataSourcesStore,
    useInsightsStore,
  );
  const [localSources, setLocalSources] = useState<any[]>([]);

  // Subscribe to data sources changes after hydration
  useEffect(() => {
    if (isHydrated) {
      import("@/lib/stores/data-sources-store").then(({ useDataSourcesStore }) => {
        setLocalSources(useDataSourcesStore.getState().getAll());

        const unsubscribe = useDataSourcesStore.subscribe((state) => {
          setLocalSources(state.getAll());
        });

        return unsubscribe;
      });
    }
  }, [isHydrated]);

  return {
    isHydrated,
    localSources,
  };
}
