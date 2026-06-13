import { useEffect } from "react";

import { useRightDock } from "@/lib/stores/useRightDock";

/**
 * Global keyboard summon for the assistant: ⌘J (mac) / Ctrl+J toggles the
 * panel. Route-independent — registered once in the shell so the assistant is
 * reachable from anywhere, matching the "global, summonable" shape. Routes
 * through the right-dock coordinator so a docked summon evicts the appearance
 * panel (shared slot).
 */
export function useAssistantHotkey(): void {
  const { toggleAssistant: toggle } = useRightDock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding ⌘/Ctrl+J doesn't flip the panel rapidly.
      if (e.repeat) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}
