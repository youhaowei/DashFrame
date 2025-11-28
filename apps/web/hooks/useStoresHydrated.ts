import { useEffect, useMemo, useState } from "react";

type PersistedStore = {
  persist?: {
    hasHydrated?: () => boolean;
    onFinishHydration?: (cb: () => void) => () => void;
  };
};

/**
 * Waits for one or more persisted Zustand stores to finish hydration.
 * Assumes stores are module singletons, so identity is stable.
 */
export function useStoresHydrated(...stores: PersistedStore[]): boolean {
  // Stores are module singletons; memoize to avoid re-subscribing every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableStores = useMemo(() => stores, []);

  const [isHydrated, setIsHydrated] = useState(() =>
    stableStores.every((store) => store.persist?.hasHydrated?.() ?? false),
  );

  useEffect(() => {
    if (isHydrated) return;

    const checkHydrated = () => {
      if (
        stableStores.every((store) => store.persist?.hasHydrated?.() ?? false)
      ) {
        setIsHydrated(true);
      }
    };

    const unsubscribes = stableStores
      .map((store) => store.persist?.onFinishHydration?.(checkHydrated))
      .filter(Boolean) as Array<() => void>;

    // In case hydration completed between render and effect
    checkHydrated();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [isHydrated, stableStores]);

  return isHydrated;
}
