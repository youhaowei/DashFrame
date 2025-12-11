"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  cn,
} from "@dashframe/ui";
import {
  type LucideIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Github,
  Dashboard,
  LayoutGrid,
  LineChart,
  Menu,
  Settings,
  Sparkles,
  Delete,
  X,
} from "@dashframe/ui/icons";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  useDataSourcesStore,
  useInsightsStore,
  useDataFramesStore,
  useVisualizationsStore,
} from "@/lib/stores";

type NavItem = {
  name: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  {
    name: "Dashboards",
    href: "/dashboards",
    description: "Build and view dashboards",
    icon: LayoutGrid,
  },
  {
    name: "Visualizations",
    href: "/visualizations",
    description: "Create, edit, and view visualizations",
    icon: Dashboard,
  },
  {
    name: "Insights",
    href: "/insights",
    description: "Manage and configure insights",
    icon: Sparkles,
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
  onClearData?: () => void;
}

function SidebarContent({
  isCollapsed = false,
  onToggleCollapse,
  onClearData,
}: SidebarContentProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border/60 border-b px-4 py-4">
        <div
          className={cn(
            "flex items-center gap-3",
            isCollapsed ? "flex-col" : "justify-between",
          )}
        >
          <Link
            href="/"
            className={cn(
              "hover:text-primary flex items-center gap-3 transition-colors",
              isCollapsed && "justify-center",
            )}
          >
            <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-2xl">
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
                  className="border-border/60 bg-background text-muted-foreground hover:bg-background h-7 w-7 rounded-full border shadow-sm transition-colors"
                  aria-label={
                    isCollapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
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
          isCollapsed
            ? "flex flex-col items-center gap-2 px-0"
            : "space-y-3 px-3",
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
                  ? "hover:bg-muted/50 h-10 w-10 items-center justify-center rounded-lg border border-transparent"
                  : "items-center gap-3 rounded-2xl border border-transparent px-3 py-2",
                isActive && !isCollapsed
                  ? "bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(59,130,246,0.25)] dark:shadow-[0_0_0_1px_rgba(59,130,246,0.45)]"
                  : !isCollapsed &&
                  "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
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
                      "border-border/50 bg-background/90 text-muted-foreground group-hover:text-foreground rounded-lg border p-2 transition-colors",
                      isActive && "text-primary border-primary/30",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-foreground text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {item.description}
                    </span>
                  </div>
                  {isActive && (
                    <span
                      className="border-primary/40 absolute inset-0 rounded-2xl border"
                      aria-hidden
                    />
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer with Settings and GitHub */}
      {!isCollapsed && (
        <div className="border-border/60 space-y-2 border-t px-4 py-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-xs transition-colors">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem
                onClick={onClearData}
                className="text-destructive focus:text-destructive"
              >
                <Delete className="mr-2 h-4 w-4" />
                Clear all data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <a
            href="https://github.com/youhaowei/dashframe"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs transition-colors"
          >
            <Github className="h-4 w-4" />
            <span>Open source</span>
          </a>
        </div>
      )}
    </div>
  );
}

export function Navigation() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearAllData = () => {
    useDataSourcesStore.getState().clear();
    useInsightsStore.getState().clear();
    useDataFramesStore.getState().clear();
    useVisualizationsStore.getState().clear();
    setShowClearConfirm(false);
    toast.success("All data cleared");
    router.push("/");
  };

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
          "border-border/60 bg-background/95/80 supports-backdrop-filter:bg-background/80 sticky top-0 hidden h-screen flex-col overflow-y-auto border-r backdrop-blur transition-all duration-300 lg:flex",
          sidebarWidth,
        )}
      >
        <SidebarContent
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
          onClearData={() => setShowClearConfirm(true)}
        />
      </aside>

      {/* Sidebar toggle handle */}
      <button
        type="button"
        onClick={() => setIsHidden((prev) => !prev)}
        className="border-border/60 bg-background text-muted-foreground hover:bg-muted hover:text-foreground fixed top-9 z-40 hidden -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 shadow-sm transition-all duration-300 lg:flex"
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
        className="bg-primary hover:bg-primary/90 fixed bottom-4 left-4 z-40 rounded-full shadow-lg lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Mobile Sidebar Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-xs gap-0 border-0 p-0">
          <div className="flex h-screen flex-col">
            <div className="border-border/60 flex items-center justify-between border-b p-4">
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
              <SidebarContent onClearData={() => setShowClearConfirm(true)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Data Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all data?</DialogTitle>
            <DialogDescription>
              This will permanently delete all data sources, insights, and
              visualizations. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClearConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearAllData}>
              Clear all data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
