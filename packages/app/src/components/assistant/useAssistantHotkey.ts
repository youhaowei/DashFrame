import { useEffect } from "react";

import { useQuery } from "@wystack/client";

import { useAssistantStore } from "@/lib/stores/assistant-store";
import { api } from "@/wystack/api";

/**
 * Global keyboard summon for the assistant: ⌘J (mac) / Ctrl+J toggles the
 * panel. Route-independent — registered once in the shell so the assistant is
 * reachable from anywhere, matching the "global, summonable" shape.
 */
export function useAssistantHotkey(): void {
  const close = useAssistantStore((s) => s.close);
  const toggle = useAssistantStore((s) => s.toggle);
  const setSetupOpen = useAssistantStore((s) => s.setSetupOpen);
  const configsResult = useQuery(api.listAssistantProviderConfigs);
  const configsLoaded =
    configsResult.data !== undefined && !configsResult.isLoading;
  const configsFailed = configsResult.isError;
  // Mirrors AssistantToggle: a failed refetch keeps the last successful data,
  // so availability follows the rows we actually have, never the error itself.
  const assistantAvailable = (configsResult.data?.length ?? 0) > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding ⌘/Ctrl+J doesn't flip the panel rapidly.
      if (e.repeat) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        if (!configsLoaded && !configsFailed) return;
        if (assistantAvailable) {
          toggle();
          return;
        }
        // Nothing cached and the query failed: retry rather than assert either
        // "configured" (a hollow rail) or "unconfigured" (a setup dialog the
        // user may not need).
        if (configsFailed) {
          configsResult.refetch().catch(() => undefined);
          return;
        }
        close();
        setSetupOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    assistantAvailable,
    close,
    configsFailed,
    configsLoaded,
    configsResult,
    setSetupOpen,
    toggle,
  ]);
}
