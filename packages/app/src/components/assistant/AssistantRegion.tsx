import { useRenderPerf } from "@/lib/perf";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useLocation } from "@tanstack/react-router";
import { type ReactNode } from "react";

import { AssistantSidebar } from "./AssistantSidebar";
import { AssistantToggle } from "./AssistantToggle";
import { useAssistantHotkey } from "./useAssistantHotkey";
import { useIsWide } from "./useIsWide";

/**
 * Lays out the center artifact + right assistant as the two right-hand regions
 * of the three-region shell (left nav is rendered by the shell outside this).
 *
 * - Registers the global ⌘J summon.
 * - When docked + open on a wide viewport, reserves a rail so the artifact
 *   reflows beside it (artifact stays primary, never covered).
 * - When floating, or on a narrow viewport where there's no room to reflow, the
 *   panel overlays the artifact without pushing it.
 * - Always renders a discoverable edge toggle.
 */
export function AssistantRegion({ children }: { children: ReactNode }) {
  useAssistantHotkey();

  // Shell render boundary — fires on every route (not data-gated), so the perf
  // HUD always has a per-route shell render sample keyed by pathname.
  const pathname = useLocation({ select: (l) => l.pathname });
  useRenderPerf(`shell:${pathname}`);

  const isOpen = useAssistantStore((s) => s.isOpen);
  const dock = useAssistantStore((s) => s.dock);
  const width = useAssistantStore((s) => s.width);
  const isWide = useIsWide();

  // Resolve to exactly one presentation so the panel mounts once:
  // - docked preference on a wide viewport → reflowing rail
  // - floating preference, or no room to reflow (narrow) → overlay
  const reflowRail = isOpen && dock === "docked" && isWide;
  const overlay = isOpen && !reflowRail;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-row gap-3">
      {/* CENTER — artifact hero, floating card */}
      <main className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-border/60 bg-neutral-bg shadow-sm">
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto">
          {children}
        </div>
      </main>

      {/* RIGHT, docked rail — reflows the artifact (wide viewports only).
          Card chrome lives here so the sidebar body stays presentation-agnostic. */}
      {reflowRail && (
        <div
          className="h-full shrink-0 overflow-hidden rounded-2xl border border-neutral-border/60 bg-neutral-bg/80 shadow-sm backdrop-blur"
          style={{ width }}
        >
          <AssistantSidebar presentation="docked" />
        </div>
      )}

      {/* Overlay — floating preference, or docked with no room to reflow. */}
      {overlay && <AssistantSidebar presentation="floating" />}

      {/* Discoverable edge summon — shown only when the panel is closed. While
          open, the panel's own header holds dismiss/dock, and a fixed toggle
          here would overlap (and intercept clicks on) those controls. */}
      {!isOpen && (
        <div className="fixed top-3 right-3 z-40">
          <AssistantToggle className="shadow-sm" />
        </div>
      )}
    </div>
  );
}
