"use client";

import { useEffect } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";

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
  useEffect(() => {
    // Trigger hydration for all persisted stores on the client
    useDataSourcesStore.persist.rehydrate();
    useDataFramesStore.persist.rehydrate();
    useVisualizationsStore.persist.rehydrate();
    useInsightsStore.persist.rehydrate();
  }, []);

  // Render children immediately - stores will be empty initially,
  // then update once hydrated (no hydration mismatch)
  return <>{children}</>;
}
