import "../globals.css";
import type { Metadata } from "next";
import { TRPCProvider } from "@/lib/trpc/Provider";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { Navigation } from "@/components/navigation";

export const metadata: Metadata = {
  title: "DashFrame",
  description: "CSV to DataFrame to Chart MVP",
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
          <TRPCProvider>
            <div className="relative isolate flex min-h-screen flex-col bg-background text-foreground">
              <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div
                  className="absolute -top-1/3 left-1/2 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(147,197,253,0.55),transparent_60%)] blur-3xl opacity-80 dark:opacity-60"
                  style={{ height: "42rem", width: "42rem" }}
                />
                <div
                  className="absolute top-1/4 left-[-10%] rounded-full bg-[radial-gradient(circle,rgba(209,128,255,0.38),transparent_65%)] blur-3xl opacity-70 dark:opacity-45 mix-blend-screen"
                  style={{ height: "36rem", width: "36rem" }}
                />
                <div
                  className="absolute bottom-[-25%] right-[-5%] rounded-full bg-[radial-gradient(circle,rgba(52,211,153,0.35),transparent_60%)] blur-3xl opacity-60 dark:opacity-40 mix-blend-color-dodge"
                  style={{ height: "32rem", width: "32rem" }}
                />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_80%,rgba(14,165,233,0.22),transparent_55%)] opacity-70 dark:opacity-45" />
                <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.12),transparent,rgba(255,255,255,0.02))] dark:bg-[linear-gradient(120deg,rgba(0,0,0,0.05),transparent,rgba(0,0,0,0.25))]" />
                <div className="absolute inset-0 bg-background/40 dark:bg-background/70 backdrop-blur-[2px]" />
              </div>

              <Navigation />

              <main className="relative z-10 flex flex-1 flex-col gap-4 px-4 pb-6 pt-4 sm:px-6 lg:px-10">
                <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4">
                  {children}
                </div>
              </main>
            </div>
            <Toaster />
          </TRPCProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
