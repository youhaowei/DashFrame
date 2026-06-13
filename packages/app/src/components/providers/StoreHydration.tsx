import { type ReactNode, useEffect } from "react";

import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * Triggers client-side rehydration for persisted Zustand stores.
 *
 * Persisted stores use `skipHydration: true` so server render and first client
 * render are deterministic (no localStorage read during SSR → no hydration
 * mismatch). This provider runs `rehydrate()` once after mount to pull the
 * persisted preferences in. Register every persisted store here.
 */
export function StoreHydration({ children }: { children: ReactNode }) {
  useEffect(() => {
    useAssistantStore.persist.rehydrate()?.catch(() => {
      // Rehydration is best-effort; a corrupt payload just means defaults.
    });
  }, []);

  return <>{children}</>;
}
