import { useCallback } from "react";

import { useAssistantStore } from "./assistant-store";
import { useShellStore } from "./shell-store";

/**
 * Coordinates the shared right Dock slot, which the appearance panel and a
 * *docked* assistant contend for. Mutual exclusion lives here, at a neutral
 * layer both stores can reach — keeping the store dependency a DAG (shell-store
 * imports assistant-store, never the reverse).
 *
 * A *floating* assistant is an overlay, not in the slot, so summoning it does
 * not close the appearance panel.
 */
export function useRightDock() {
  const toggleAssistantRaw = useAssistantStore((s) => s.toggle);
  const setRightPanelOpen = useShellStore((s) => s.setRightPanelOpen);

  /** Toggle the assistant; if it lands open, evict the appearance panel (shared slot). */
  const toggleAssistant = useCallback(() => {
    toggleAssistantRaw();
    if (useAssistantStore.getState().isOpen) setRightPanelOpen(false);
  }, [toggleAssistantRaw, setRightPanelOpen]);

  return { toggleAssistant };
}
