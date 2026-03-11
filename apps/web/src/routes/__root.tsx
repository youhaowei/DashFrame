/// <reference types="vite/client" />
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Navigation } from "@/components/navigation";
import { DuckDBProvider } from "@/components/providers/DuckDBProvider";
import { PostHogPageView } from "@/components/providers/PostHogPageView";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import { VisualizationSetup } from "@/components/providers/VisualizationSetup";
import { ThemeProvider } from "@/components/theme-provider";
import { TRPCProvider } from "@/lib/trpc/Provider";
import { DatabaseProvider } from "@dashframe/core";
import { TooltipProvider } from "@stdui/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "@/globals.css?url";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "DashFrame" },
      {
        name: "description",
        content: "Transform your data into beautiful visualizations",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-head-element -- TanStack Start uses <head>, not next/head */}
      <head>
        <HeadContent />
      </head>
      <body className="bg-neutral-bg font-sans text-neutral-fg">
        <ThemeProvider>
          <PostHogProvider>
            <PostHogPageView />
            <TooltipProvider>
              <TRPCProvider>
                <DatabaseProvider>
                  <DuckDBProvider>
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

                      <div className="relative isolate flex min-h-screen flex-row bg-neutral-bg text-neutral-fg">
                        <Navigation />

                        <main className="relative z-10 flex h-full w-full flex-1 flex-col overflow-hidden">
                          <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto">
                            {children}
                          </div>
                        </main>
                      </div>
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
              </TRPCProvider>
            </TooltipProvider>
          </PostHogProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
