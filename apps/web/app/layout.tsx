import { ConfirmDialog } from "@/components/confirm-dialog";
import { Navigation } from "@/components/navigation";
import { DuckDBProvider } from "@/components/providers/DuckDBProvider";
import { PostHogPageView } from "@/components/providers/PostHogPageView";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import { VisualizationSetup } from "@/components/providers/VisualizationSetup";
import { ThemeProvider } from "@/components/theme-provider";
import { TRPCProvider } from "@/lib/trpc/Provider";
import { DatabaseProvider } from "@dashframe/core";
import { GeistMono, GeistSans, TooltipProvider } from "@dashframe/ui";
import type { Metadata } from "next";
import { Toaster } from "sonner";
import "../globals.css";

export const metadata: Metadata = {
  title: "DashFrame",
  description: "Transform your data into beautiful visualizations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} bg-background font-sans text-foreground`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
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
                        <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px] dark:bg-background/75" />
                      </div>

                      <div className="relative isolate flex min-h-screen flex-row bg-background text-foreground">
                        <Navigation />

                        <main className="relative z-10 flex h-full w-full flex-1 flex-col overflow-hidden">
                          <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto">
                            {children}
                          </div>
                        </main>
                      </div>
                      <Toaster />
                      <ConfirmDialog />
                    </VisualizationSetup>
                  </DuckDBProvider>
                </DatabaseProvider>
              </TRPCProvider>
            </TooltipProvider>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
