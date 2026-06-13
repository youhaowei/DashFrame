import { useRenderPerf } from "@/lib/perf";
import { useLocation } from "@tanstack/react-router";
import { Stage } from "@wystack/ui";
import { type ReactNode } from "react";

import { useAssistantHotkey } from "./useAssistantHotkey";

/**
 * The center Stage. Registers the global ⌘J assistant summon and the per-route
 * render-perf boundary. The assistant itself lives in the shared right Dock
 * (see RightDock), which reflows the Stage when open.
 */
export function AssistantRegion({ children }: { children: ReactNode }) {
  useAssistantHotkey();

  // Shell render boundary — fires on every route (not data-gated), so the perf
  // HUD always has a per-route shell render sample keyed by pathname.
  const pathname = useLocation({ select: (l) => l.pathname });
  useRenderPerf(`shell:${pathname}`);

  return <Stage>{children}</Stage>;
}
