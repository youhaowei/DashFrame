"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LineChart } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { name: "Visualizations", href: "/" },
  { name: "Data Sources", href: "/data-sources" },
  { name: "Data Frames", href: "/data-frames" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1.5 text-sm font-semibold tracking-tight shadow-sm"
          >
            <span className="rounded-full bg-primary/15 p-1.5 text-primary">
              <LineChart className="h-4 w-4" />
            </span>
            DashFrame
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto rounded-full border border-border/70 bg-card/60 px-1 py-1 text-sm font-medium shadow-inner shadow-black/5">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full px-4 py-1.5 transition-colors",
                  pathname === item.href
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link href="/data-sources">Manage Data</Link>
          </Button>
          <Button asChild size="sm" className="hidden lg:inline-flex">
            <Link href="/data-frames">View Data Frames</Link>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
