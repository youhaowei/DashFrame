import "../globals.css";
import type { Metadata } from "next";
import { TRPCProvider } from "@/lib/trpc/Provider";
import { Toaster } from "@/components/ui/sonner";

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
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <TRPCProvider>
          <main className="min-h-screen">{children}</main>
          <Toaster />
        </TRPCProvider>
      </body>
    </html>
  );
}
