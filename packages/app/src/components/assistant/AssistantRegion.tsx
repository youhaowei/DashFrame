import { useRenderPerf } from "@/lib/perf";
import { useLocation } from "@tanstack/react-router";
import { Stage } from "@wystack/ui";
import { type ReactNode } from "react";

import { useAssistantHotkey } from "./useAssistantHotkey";

/**
 * The center Stage. Registers the global ⌘J assistant summon and the per-route
 * render-perf boundary. The assistant itself lives in the shared right Dock
 * (see RightDock) — whether it reflows the Stage (`separate`) or floats over it
 * (`overlay`) is the right Dock's mode, owned globally by the shell store.
 */
export function AssistantRegion({ children }: { children: ReactNode }) {
  useAssistantHotkey();

  // Shell render boundary — fires on every route (not data-gated), so the perf
  // HUD always has a per-route shell render sample keyed by pathname.
  const pathname = useLocation({ select: (l) => l.pathname });
  useRenderPerf(`shell:${pathname}`);

  return <Stage>{children}</Stage>;
}
