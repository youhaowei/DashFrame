"use client";

import { useEffect, useState, createContext, useContext } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDashboardsStore } from "@/lib/stores/dashboards-store";

/** Context to track whether all stores have been hydrated from localStorage */
const HydrationContext = createContext(false);

/**
 * Hook to check if stores have been hydrated from localStorage.
 * Useful for gating redirects or UI that depends on persisted data.
 */
export function useStoreHydrated() {
  return useContext(HydrationContext);
}

/**
 * StoreHydration component that handles client-side hydration of Zustand stores.
 * This prevents hydration mismatches by ensuring stores are hydrated consistently.
 *
 * How it works:
 * 1. All stores have `skipHydration: true` to prevent automatic hydration
 * 2. This component manually triggers hydration on the client after mount
 * 3. Children render immediately with empty stores (consistent with SSR)
 * 4. Stores update once hydrated (React re-renders naturally, no mismatch)
 */
export function StoreHydration({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Trigger hydration for all persisted stores on the client, but only once
    const stores = [
      useDataSourcesStore,
      useDataFramesStore,
      useVisualizationsStore,
      useInsightsStore,
      useDashboardsStore,
    ];

    const hydrate = async () => {
      // Wait for all stores to complete hydration before signaling ready
      await Promise.all(
        stores.map((store) => {
          if (store.persist && !store.persist.hasHydrated?.()) {
            return store.persist.rehydrate?.();
          }
          return Promise.resolve();
        }),
      );

      setIsHydrated(true);
    };

    hydrate();
  }, []);

  // Render children immediately - stores will be empty initially,
  // then update once hydrated (no hydration mismatch)
  return (
    <HydrationContext.Provider value={isHydrated}>
      {children}
    </HydrationContext.Provider>
  );
}
