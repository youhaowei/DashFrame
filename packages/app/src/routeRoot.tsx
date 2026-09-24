import {
  useLayoutEffect,
  useRef,
  useState,
  type FC,
  type ReactNode,
  type RefObject,
} from "react";

import { AppTopBar } from "@/components/AppTopBar";
import { useRenderPerf } from "@/lib/perf";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Navigation } from "@/components/navigation";
import { ConnectorSetup } from "@/components/providers/ConnectorSetup";
import { VisualizationSetup } from "@/components/providers/VisualizationSetup";
import { CommandPalette } from "@/components/shell/command-palette";
import { ContextPanelProvider } from "@/components/shell/context-panel-outlet";
import { ShellRails } from "@/components/shell/ShellRails";
import { AppDragProvider } from "@/components/shelf/drag-context";
import { CarriedChip } from "@/components/shelf/ShelfChip";
import { ShelfScope } from "@/components/shelf/shelf-scope";
import { TopBarTabsProvider } from "@/components/shell/topbar-tabs";
import { ThemeProvider } from "@/components/theme-provider";
import { WebMCPProvider } from "@/components/webmcp/WebMCPProvider";
import { PlatformProvider } from "@/lib/platform";
import { Outlet, useLocation } from "@tanstack/react-router";
import { Stage, TooltipProvider } from "@wystack/ui-react";
import { Toaster } from "sonner";

/**
 * Host-injected wrapper for surface-specific providers. The web host passes a
 * wrapper that mounts PostHog (analytics) around the portable provider tree;
 * the Electron renderer passes nothing (pass-through). Web-only concerns never
 * enter the shared package — they ride in through this slot, supplied via the
 * router context (see AppRouterContext).
 */
export type ProviderWrapper = FC<{ children: ReactNode }>;

/**
 * Router context each host supplies. Defined here (not in __root.tsx) so the
 * package barrel can export it without depending on a route file — route files
 * need a host-generated route tree to typecheck, so they're excluded from this
 * package's standalone typecheck.
 */
export interface AppRouterContext {
  providerWrapper?: ProviderWrapper;
}

const PassThrough: ProviderWrapper = ({ children }) => <>{children}</>;

/**
 * The chrome layout, built on the @wystack/ui-react layout shell:
 *
 *   row (full window height)
 *   ├── Dock side=left       — Navigation (flat, on the canvas)
 *   └── column
 *       ├── TopBar           — window chrome above the content
 *       └── row
 *           ├── Stage            — the primary content surface (artifact/page)
 *           └── Dock side=right  — page-scoped context panel family
 *
 * The left nav and top bar sit *flat* on the canvas (window chrome); the Stage
 * is the elevated primary surface; side rails float as vibrancy Docks. Region
 * roles are owned here — the primitives only own shape.
 */
function Shell() {
  const shellRowRef = useRef<HTMLDivElement>(null);
  const shellWidth = useElementWidth(shellRowRef);
  const pathname = useLocation({ select: (l) => l.pathname });
  useRenderPerf(`shell:${pathname}`);

  return (
    <div
      ref={shellRowRef}
      className="relative isolate flex h-screen flex-row gap-[var(--surface-inset)] px-[var(--surface-inset)] text-neutral-fg"
    >
      <Navigation />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <div className="relative flex min-h-0 flex-1 flex-row gap-[var(--surface-inset)] pb-[var(--surface-inset)]">
          <Stage>
            <Outlet />
          </Stage>
          <ShellRails shellWidth={shellWidth} />
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}

function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export function RouteRoot({
  providerWrapper: HostProviders = PassThrough,
}: {
  providerWrapper?: ProviderWrapper;
}) {
  return (
    <div className="bg-surface-base font-sans text-neutral-fg">
      <ThemeProvider>
        <HostProviders>
          <TooltipProvider>
            <ConnectorSetup />
            <VisualizationSetup>
              <ContextPanelProvider>
                <PlatformProvider>
                  <TopBarTabsProvider>
                    <WebMCPProvider>
                      <AppDragProvider
                        overlay={(drag) => <CarriedChip item={drag.item} />}
                      >
                        <ShelfScope>
                          <Shell />
                        </ShelfScope>
                      </AppDragProvider>
                    </WebMCPProvider>
                  </TopBarTabsProvider>
                </PlatformProvider>
              </ContextPanelProvider>
              <Toaster
                toastOptions={{
                  style: {
                    background: "var(--neutral-bg)",
                    color: "var(--neutral-fg)",
                    border: "1px solid var(--neutral-border)",
                  },
                }}
              />
              <ConfirmDialog />
            </VisualizationSetup>
          </TooltipProvider>
        </HostProviders>
      </ThemeProvider>
    </div>
  );
}
