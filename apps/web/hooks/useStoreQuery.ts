import { useEffect, useState } from "react";

type PersistedStore<TState> = {
  <TResult>(selector: (state: TState) => TResult): TResult;
  getState: () => TState;
  subscribe: (listener: (state: TState) => void) => () => void;
  persist?: {
    hasHydrated?: () => boolean;
    onFinishHydration?: (cb: () => void) => () => void;
  };
};

type Options = {
  requireHydration?: boolean;
};

/**
 * React-query style wrapper for Zustand selectors with persisted hydration.
 *
 * Returns `{ data, isLoading, isError, isSuccess }` so consumers can render
 * loading states without worrying about hydration order.
 *
 * Note: All stores now use cached arrays for stable references, so we no longer
 * need custom equality functions. Zustand's default reference equality is sufficient.
 */
export function useStoreQuery<TState, TResult>(
  store: PersistedStore<TState>,
  selector: (state: TState) => TResult,
  { requireHydration = true }: Options = {},
) {
  // Use Zustand's selector with default reference equality
  // Stores return cached arrays, so references only change when data actually changes
  const data = store(selector);

  const [isHydrated, setIsHydrated] = useState(
    // If no persist middleware, consider already hydrated (nothing to hydrate)
    () => (store.persist ? (store.persist.hasHydrated?.() ?? false) : true),
  );

  useEffect(() => {
    if (!requireHydration || isHydrated) return;

    const maybeHydrated = () => {
      if (store.persist?.hasHydrated?.()) {
        setIsHydrated(true);
      }
    };

    const unsub = store.persist?.onFinishHydration?.(maybeHydrated);
    maybeHydrated();

    return () => {
      unsub?.();
    };
  }, [isHydrated, requireHydration, store]);

  const isLoading = requireHydration ? !isHydrated : false;

  return {
    data,
    isLoading,
    isError: false,
    isSuccess: !isLoading,
  };
}
