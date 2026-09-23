import { type ReactNode, useEffect } from "react";

import { useInsightCanvasStore } from "@/lib/stores/insight-canvas-store";

export function StoreHydration({ children }: { children: ReactNode }) {
  useEffect(() => {
    useInsightCanvasStore.persist.rehydrate()?.catch(() => {
      // Rehydration is best-effort; a corrupt payload just means defaults.
    });
  }, []);

  return <>{children}</>;
}
