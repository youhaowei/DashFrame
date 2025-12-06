import "../globals.css";
import type { Metadata } from "next";
import { TRPCProvider } from "@/lib/trpc/Provider";
import { TooltipProvider } from "@dashframe/ui";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { Navigation } from "@/components/navigation";
import { StoreHydration } from "@/components/providers/StoreHydration";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import { PostHogPageView } from "@/components/providers/PostHogPageView";
import { NoSSR } from "@/components/providers/NoSSR";
import { DuckDBProvider } from "@/components/providers/DuckDBProvider";

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
      <body className="bg-background text-foreground" suppressHydrationWarning>
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
                <NoSSR>
                  <DuckDBProvider>
                    <StoreHydration>
                      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                        <div
                          className="absolute -top-1/3 left-1/2 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(147,197,253,0.55),transparent_60%)] opacity-80 blur-3xl dark:opacity-60"
                          style={{ height: "42rem", width: "42rem" }}
                        />
                        <div
                          className="absolute left-[-10%] top-1/4 rounded-full bg-[radial-gradient(circle,rgba(209,128,255,0.38),transparent_65%)] opacity-70 mix-blend-screen blur-3xl dark:opacity-45"
                          style={{ height: "36rem", width: "36rem" }}
                        />
                        <div
                          className="absolute bottom-[-25%] right-[-5%] rounded-full bg-[radial-gradient(circle,rgba(52,211,153,0.35),transparent_60%)] opacity-60 mix-blend-color-dodge blur-3xl dark:opacity-40"
                          style={{ height: "32rem", width: "32rem" }}
                        />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_80%,rgba(14,165,233,0.22),transparent_55%)] opacity-70 dark:opacity-45" />
                        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.12),transparent,rgba(255,255,255,0.02))] dark:bg-[linear-gradient(120deg,rgba(0,0,0,0.05),transparent,rgba(0,0,0,0.25))]" />
                        <div className="bg-background/40 dark:bg-background/70 absolute inset-0 backdrop-blur-[2px]" />
                      </div>

                      <div className="bg-background text-foreground relative isolate flex min-h-screen flex-row">
                        <Navigation />

                        <main className="relative z-10 flex h-full w-full flex-1 flex-col overflow-hidden">
                          <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto">
                            {children}
                          </div>
                        </main>
                      </div>
                      <Toaster />
                    </StoreHydration>
                  </DuckDBProvider>
                </NoSSR>
              </TRPCProvider>
            </TooltipProvider>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
