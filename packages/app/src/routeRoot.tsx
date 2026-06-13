import type { FC, ReactNode } from "react";

import { AppTopBar } from "@/components/AppTopBar";
import { RightDock } from "@/components/RightDock";
import { AssistantRegion } from "@/components/assistant/AssistantRegion";
import { ArtifactContextProvider } from "@/components/assistant/artifact-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Navigation } from "@/components/navigation";
import { ConnectorSetup } from "@/components/providers/ConnectorSetup";
import { DuckDBProvider } from "@/components/providers/DuckDBProvider";
import { StoreHydration } from "@/components/providers/StoreHydration";
import { VisualizationSetup } from "@/components/providers/VisualizationSetup";
import { ThemeProvider } from "@/components/theme-provider";
import { PlatformProvider } from "@/lib/platform";
import { DatabaseProvider } from "@dashframe/core";
import { Outlet } from "@tanstack/react-router";
import { TooltipProvider } from "@wystack/ui";
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
 * The chrome layout, built on the @wystack/ui layout shell:
 *
 *   TopBar  (full-width window chrome)
 *   ├── Dock side=left   — Navigation (flat, on the canvas)
 *   ├── Stage            — the primary content surface (artifact/page)
 *   └── Dock side=right  — appearance panel ⊕ docked assistant (shared slot)
 *
 * The left nav and top bar sit *flat* on the canvas (window chrome); the Stage
 * is the elevated primary surface; side panels float as vibrancy Docks. Region
 * roles are owned here — the primitives only own shape.
 */
function Shell() {
  return (
    <div className="relative isolate flex h-screen flex-col text-neutral-fg">
      <AppTopBar />
      <div className="relative flex min-h-0 flex-1 flex-row gap-[var(--surface-inset)] px-[var(--surface-inset)] pb-[var(--surface-inset)]">
        <Navigation />
        <AssistantRegion>
          <Outlet />
        </AssistantRegion>
        <RightDock />
      </div>
    </div>
  );
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
            <DatabaseProvider>
              <DuckDBProvider>
                <ConnectorSetup />
                <VisualizationSetup>
                  <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                    <div
                      className="absolute -top-1/3 left-1/2 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(163,163,163,0.35),transparent_60%)] opacity-70 blur-3xl dark:opacity-50"
                      style={{ height: "42rem", width: "42rem" }}
                    />
                    <div
                      className="absolute top-1/4 left-[-10%] rounded-full bg-[radial-gradient(circle,rgba(115,115,115,0.28),transparent_65%)] opacity-60 mix-blend-screen blur-3xl dark:opacity-40"
                      style={{ height: "36rem", width: "36rem" }}
                    />
                    <div
                      className="absolute right-[-5%] bottom-[-25%] rounded-full bg-[radial-gradient(circle,rgba(82,82,82,0.22),transparent_60%)] opacity-50 mix-blend-color-dodge blur-3xl dark:opacity-35"
                      style={{ height: "32rem", width: "32rem" }}
                    />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_80%,rgba(64,64,64,0.16),transparent_55%)] opacity-60 dark:opacity-40" />
                    <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.1),transparent,rgba(255,255,255,0.02))] dark:bg-[linear-gradient(120deg,rgba(0,0,0,0.05),transparent,rgba(0,0,0,0.2))]" />
                    <div className="absolute inset-0 bg-neutral-bg/50 backdrop-blur-[2px] dark:bg-neutral-bg/75" />
                  </div>

                  <StoreHydration>
                    <ArtifactContextProvider>
                      <PlatformProvider>
                        <Shell />
                      </PlatformProvider>
                    </ArtifactContextProvider>
                  </StoreHydration>
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
              </DuckDBProvider>
            </DatabaseProvider>
          </TooltipProvider>
        </HostProviders>
      </ThemeProvider>
    </div>
  );
}
