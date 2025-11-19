"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  Menu,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type NavItem = {
  name: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  {
    name: "Visualizations",
    href: "/",
    description: "Create, edit, and view visualizations",
    icon: LayoutDashboard,
  },
  {
    name: "Data Sources",
    href: "/data-sources",
    description: "Manage data sources",
    icon: Database,
  },
];

interface SidebarContentProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SidebarContent({
  isCollapsed = false,
  onToggleCollapse,
}: SidebarContentProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border/60 px-4 py-4">
        <div
          className={cn(
            "flex items-center gap-3",
            isCollapsed ? "flex-col" : "justify-between",
          )}
        >
          <Link
            href="/"
            className={cn(
              "flex items-center gap-3 transition-colors hover:text-primary",
              isCollapsed && "justify-center",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LineChart className="h-5 w-5" />
            </span>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight">
                  DashFrame
                </span>
              </div>
            )}
          </Link>
          {(onToggleCollapse || !isCollapsed) && (
            <div
              className={cn(
                "flex items-center gap-1.5",
                isCollapsed && "w-full justify-center",
              )}
            >
              {!isCollapsed && <ThemeToggle />}
              {onToggleCollapse && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleCollapse}
                  className="h-7 w-7 rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm transition-colors hover:bg-background"
                  aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronLeft className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Navigation Links */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto py-4",
          isCollapsed ? "flex flex-col items-center gap-2 px-0" : "space-y-3 px-3",
        )}
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group relative flex transition-all duration-200",
                isCollapsed
                  ? "h-10 w-10 items-center justify-center rounded-lg border border-transparent hover:bg-muted/50"
                  : "items-center gap-3 rounded-2xl border border-transparent px-3 py-2",
                isActive && !isCollapsed
                  ? "bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(59,130,246,0.25)] dark:shadow-[0_0_0_1px_rgba(59,130,246,0.45)]"
                  : !isCollapsed && "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                isActive && isCollapsed && "bg-primary/10 text-primary",
              )}
              title={isCollapsed ? item.name : undefined}
            >
              {isCollapsed ? (
                <item.icon className="h-5 w-5" />
              ) : (
                <>
                  <span
                    className={cn(
                      "rounded-lg border border-border/50 bg-background/90 p-2 text-muted-foreground transition-colors group-hover:text-foreground",
                      isActive && "text-primary border-primary/30",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </div>
                  {isActive && (
                    <span className="absolute inset-0 rounded-2xl border border-primary/40" aria-hidden />
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Support + theme */}
      {!isCollapsed && (
        <div className="border-t border-border/60 px-4 py-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <LifeBuoy className="h-4 w-4" />
              Support
            </div>
            <Button asChild variant="link" size="sm" className="px-0 text-primary">
              <a href="mailto:hello@dashframe.dev">Email us</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  let sidebarWidth = "w-72";
  if (isHidden) sidebarWidth = "w-0";
  else if (isCollapsed) sidebarWidth = "w-20";

  let handleLeft = "18rem";
  if (isHidden) handleLeft = "0px";
  else if (isCollapsed) handleLeft = "5rem";

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-border/60 bg-background/95/80 sticky top-0 h-screen overflow-y-auto transition-all duration-300 backdrop-blur supports-backdrop-filter:bg-background/80",
          sidebarWidth,
        )}
      >
        <SidebarContent
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
        />
      </aside>

      {/* Sidebar toggle handle */}
      <button
        type="button"
        onClick={() => setIsHidden((prev) => !prev)}
        className="hidden lg:flex fixed top-1/2 z-40 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-border/60 bg-background text-muted-foreground shadow-sm transition-all duration-300 hover:bg-muted hover:text-foreground"
        style={{
          left: handleLeft,
          height: "3rem",
          width: "1.5rem",
        }}
        aria-label={isHidden ? "Show sidebar" : "Hide sidebar"}
        title={isHidden ? "Show sidebar" : "Hide sidebar"}
      >
        {isHidden ? (
          <ChevronsRight className="h-4 w-4" />
        ) : (
          <ChevronsLeft className="h-4 w-4" />
        )}
      </button>

      {/* Mobile Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 lg:hidden rounded-full shadow-lg bg-primary hover:bg-primary/90"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Mobile Sidebar Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-xs p-0 gap-0 border-0">
          <div className="flex h-screen flex-col">
            <div className="flex items-center justify-between border-b border-border/60 p-4">
              <span className="text-sm font-semibold">Menu</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
