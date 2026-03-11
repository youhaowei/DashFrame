import { ThemeToggle } from "@/components/theme-toggle";
import { useToastStore } from "@/lib/stores";
import {
  useDashboardMutations,
  useDataFrameMutations,
  useDataSourceMutations,
  useInsightMutations,
  useVisualizationMutations,
} from "@dashframe/core";
import {
  type LucideIcon,
  ChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CloseIcon,
  DashboardIcon,
  DatabaseIcon,
  DeleteIcon,
  GithubIcon,
  GridIcon,
  MenuIcon,
  SettingsIcon,
  SparklesIcon,
} from "@stdui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@stdui/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

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
    icon: GridIcon,
  },
  {
    name: "Visualizations",
    href: "/visualizations",
    description: "Create, edit, and view visualizations",
    icon: DashboardIcon,
  },
  {
    name: "Insights",
    href: "/insights",
    description: "Manage and configure insights",
    icon: SparklesIcon,
  },
  {
    name: "Data Sources",
    href: "/data-sources",
    description: "Manage data sources",
    icon: DatabaseIcon,
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
  const { pathname } = useLocation();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-neutral-border/60 px-4 py-4">
        <div
          className={cn(
            "flex items-center gap-3",
            isCollapsed ? "flex-col" : "justify-between",
          )}
        >
          <Link
            to="/"
            className={cn(
              "flex items-center gap-3 transition-colors hover:text-palette-primary",
              isCollapsed && "justify-center",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-2xl bg-palette-primary/10 text-palette-primary">
              <ChartIcon className="h-5 w-5" />
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
                  icon={isCollapsed ? ChevronRightIcon : ChevronLeftIcon}
                  iconOnly
                  label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={onToggleCollapse}
                  className="h-7 w-7 rounded-full border border-neutral-border/60 bg-neutral-bg text-neutral-fg-subtle shadow-sm transition-colors hover:bg-neutral-bg"
                  tooltip={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                />
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
              to={item.href}
              className={cn(
                "group relative flex transition-all duration-200",
                isCollapsed
                  ? "h-10 w-10 items-center justify-center rounded-lg border border-transparent hover:bg-neutral-bg-muted/50"
                  : "items-center gap-3 rounded-2xl border border-transparent px-3 py-2",
                isActive && !isCollapsed
                  ? "bg-palette-primary/10 text-palette-primary shadow-[0_0_0_1px_rgba(59,130,246,0.25)] dark:shadow-[0_0_0_1px_rgba(59,130,246,0.45)]"
                  : !isCollapsed &&
                      "text-neutral-fg-subtle hover:bg-neutral-bg-muted/50 hover:text-neutral-fg",
                isActive &&
                  isCollapsed &&
                  "bg-palette-primary/10 text-palette-primary",
              )}
              title={isCollapsed ? item.name : undefined}
            >
              {isCollapsed ? (
                <item.icon className="h-5 w-5" />
              ) : (
                <>
                  <span
                    className={cn(
                      "rounded-lg border border-neutral-border/50 bg-neutral-bg/90 p-2 text-neutral-fg-subtle transition-colors group-hover:text-neutral-fg",
                      isActive &&
                        "border-palette-primary/30 text-palette-primary",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-medium text-neutral-fg">
                      {item.name}
                    </span>
                    <span className="text-xs text-neutral-fg-subtle">
                      {item.description}
                    </span>
                  </div>
                  {isActive && (
                    <span
                      className="absolute inset-0 rounded-2xl border border-palette-primary/40"
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
        <div className="space-y-2 border-t border-neutral-border/60 px-4 py-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg">
                <SettingsIcon className="h-4 w-4" />
                <span>Settings</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem
                onClick={onClearData}
                className="text-palette-danger focus:text-palette-danger"
              >
                <DeleteIcon className="mr-2 h-4 w-4" />
                Clear all data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <a
            href="https://github.com/youhaowei/dashframe"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg"
          >
            <GithubIcon className="h-4 w-4" />
            <span>Open source</span>
          </a>
        </div>
      )}
    </div>
  );
}

export function Navigation() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const { showSuccess } = useToastStore();
  const { remove: removeDataSource } = useDataSourceMutations();
  const { remove: removeInsight } = useInsightMutations();
  const { clear: clearDataFrames } = useDataFrameMutations();
  const { remove: removeVisualization } = useVisualizationMutations();
  const { remove: removeDashboard } = useDashboardMutations();

  const handleClearAllData = async () => {
    // Get all items first
    const { db } = await import("@dashframe/core-dexie");
    const allDataSources = await db.dataSources.toArray();
    const allInsights = await db.insights.toArray();
    const allVisualizations = await db.visualizations.toArray();
    const allDashboards = await db.dashboards.toArray();

    // Remove all data sources (this will cascade delete data tables)
    for (const source of allDataSources) {
      await removeDataSource(source.id);
    }

    // Remove all insights
    for (const insight of allInsights) {
      await removeInsight(insight.id);
    }

    // Remove all visualizations
    for (const viz of allVisualizations) {
      await removeVisualization(viz.id);
    }

    // Remove all dashboards
    for (const dashboard of allDashboards) {
      await removeDashboard(dashboard.id);
    }

    // Clear data frames
    await clearDataFrames();

    setShowClearConfirm(false);
    showSuccess("All data cleared");
    navigate({ to: "/" });
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
          "bg-neutral-bg/95/80 sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-neutral-border/60 backdrop-blur transition-all duration-300 supports-backdrop-filter:bg-neutral-bg/80 lg:flex",
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
        className="fixed top-9 z-40 hidden -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-neutral-border/60 bg-neutral-bg text-neutral-fg-subtle shadow-sm transition-all duration-300 hover:bg-neutral-bg-muted hover:text-neutral-fg lg:flex"
        style={{
          left: handleLeft,
          height: "3rem",
          width: "1.5rem",
        }}
        aria-label={isHidden ? "Show sidebar" : "Hide sidebar"}
        title={isHidden ? "Show sidebar" : "Hide sidebar"}
      >
        {isHidden ? (
          <ChevronsRightIcon className="h-4 w-4" />
        ) : (
          <ChevronsLeftIcon className="h-4 w-4" />
        )}
      </button>

      {/* Mobile Toggle Button */}
      <Button
        variant="ghost"
        icon={MenuIcon}
        iconOnly
        label="Open menu"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 rounded-full bg-palette-primary shadow-lg hover:bg-palette-primary/90 lg:hidden"
      />

      {/* Mobile Sidebar Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-xs gap-0 border-0 p-0">
          <div className="flex h-screen flex-col">
            <div className="flex items-center justify-between border-b border-neutral-border/60 p-4">
              <span className="text-sm font-semibold">Menu</span>
              <Button
                variant="ghost"
                icon={CloseIcon}
                iconOnly
                label="Close menu"
                onClick={() => setIsOpen(false)}
              />
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
              label="Cancel"
              onClick={() => setShowClearConfirm(false)}
            />
            <Button
              color="danger"
              label="Clear all data"
              onClick={handleClearAllData}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
