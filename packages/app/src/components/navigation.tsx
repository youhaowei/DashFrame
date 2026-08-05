import { AccessCredentialsDialog } from "@/components/access-credentials/AccessCredentialsDialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAccessCapabilities } from "@/data";
import { clearAllData } from "@/lib/data-access/data-frames";
import { PerfHud } from "@/lib/perf";
import { useToastStore } from "@/lib/stores";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useShellStore } from "@/lib/stores/shell-store";
import { api } from "@/wystack/api";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@wystack/client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dock,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@wystack/ui-react";
import {
  type LucideIcon,
  ChartIcon,
  CloseIcon,
  DashboardIcon,
  DatabaseIcon,
  DeleteIcon,
  FileIcon,
  GithubIcon,
  GridIcon,
  MenuIcon,
  SettingsIcon,
  SparklesIcon,
} from "@wystack/ui-react/icons";
import { type ReactNode, useState } from "react";

import {
  DESKTOP_NAV_BREAKPOINT_CLASS,
  DESKTOP_NAV_WIDTH,
} from "./shell/layout-constants";

type NavItem = {
  name: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  {
    name: "Drafts",
    href: "/drafts",
    description: "Drafts",
    icon: FileIcon,
  },
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
  onClearData?: () => void;
  onAssistantProviders?: () => void;
  onAccessCredentials?: () => void;
  /**
   * Extra rows for the footer, below Settings/Open source — dev tooling like
   * the perf HUD. Supplied only by the desktop nav so the mobile dialog doesn't
   * mount a second instance (duplicate hotkey listeners, duplicate panels).
   */
  footerSlot?: ReactNode;
  pendingDraftCount: number;
}

function SidebarContent({
  onClearData,
  onAssistantProviders,
  onAccessCredentials,
  footerSlot,
  pendingDraftCount,
}: SidebarContentProps) {
  const pathname = useLocation({ select: (l) => l.pathname });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center gap-2.5 transition-colors hover:text-palette-primary"
          >
            <span className="flex size-8 items-center justify-center rounded-xl bg-palette-primary/10 text-palette-primary">
              <ChartIcon className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              DashFrame
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.name}
              to={item.href as never}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                isActive
                  ? "bg-neutral-bg text-neutral-fg shadow-[var(--surface-shadow)]"
                  : "text-neutral-fg-subtle hover:bg-neutral-bg/60 hover:text-neutral-fg",
              )}
            >
              <item.icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive
                    ? "text-palette-primary"
                    : "text-neutral-fg-subtle group-hover:text-neutral-fg",
                )}
              />
              <span className="truncate text-sm font-medium">{item.name}</span>
              {item.href === "/drafts" && pendingDraftCount > 0 ? (
                <Badge
                  variant="soft"
                  color="secondary"
                  className="ml-auto min-w-5 justify-center text-[10px]"
                  // A bare digit next to "Drafts" reads as "Drafts 3" to a
                  // screen reader, which says nothing about what the 3 counts.
                  aria-label={
                    pendingDraftCount === 1
                      ? "1 draft waiting for review"
                      : `${pendingDraftCount} drafts waiting for review`
                  }
                >
                  {pendingDraftCount}
                </Badge>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer with Settings and GitHub */}
      <div className="space-y-2 px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex w-full items-center gap-2 text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg">
                <SettingsIcon className="h-4 w-4" />
                <span>Settings</span>
              </button>
            }
          />
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onClick={onAssistantProviders}>
              <SparklesIcon className="mr-2 h-4 w-4" />
              Assistant providers
            </DropdownMenuItem>
            {onAccessCredentials ? (
              <DropdownMenuItem onClick={onAccessCredentials}>
                <DatabaseIcon className="mr-2 h-4 w-4" />
                Access credentials
              </DropdownMenuItem>
            ) : null}
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
        {footerSlot}
      </div>
    </div>
  );
}

export function Navigation() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAccessCredentials, setShowAccessCredentials] = useState(false);
  const setAssistantSetupOpen = useAssistantStore((s) => s.setSetupOpen);
  const accessCapabilities = useAccessCapabilities();
  const { data: drafts = [] } = useQuery(api.listDrafts, { args: {} });
  const canManageAccessCredentials =
    accessCapabilities.data?.canManageCredentials === true;

  const leftNavOpen = useShellStore((s) => s.leftNavOpen);

  const { showError, showSuccess } = useToastStore();

  const handleClearAllData = async () => {
    try {
      await clearAllData();
      setShowClearConfirm(false);
      showSuccess("All data cleared");
      navigate({ to: "/" });
    } catch (error) {
      showError("Failed to clear data", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  return (
    <>
      {/* Desktop nav — a flat left Dock (surface={false}): window chrome on the
          canvas, not a floating card, so the Stage stays the primary surface.
          Visibility is driven from the top-bar toggle via the shell store. */}
      <Dock
        side="left"
        open={leftNavOpen}
        width={DESKTOP_NAV_WIDTH}
        surface={false}
        className={cn("hidden", DESKTOP_NAV_BREAKPOINT_CLASS)}
        aria-label="Primary navigation"
      >
        <div
          className="flex h-full flex-col"
          style={{ width: DESKTOP_NAV_WIDTH }}
        >
          <SidebarContent
            pendingDraftCount={drafts.length}
            onClearData={() => setShowClearConfirm(true)}
            onAssistantProviders={() => setAssistantSetupOpen(true)}
            onAccessCredentials={
              canManageAccessCredentials
                ? () => setShowAccessCredentials(true)
                : undefined
            }
            footerSlot={<PerfHud />}
          />
        </div>
      </Dock>

      {/* Mobile Toggle Button */}
      <Button
        variant="ghost"
        icon={MenuIcon}
        iconOnly
        label="Open menu"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 rounded-full bg-palette-primary shadow-lg hover:bg-palette-primary/90 min-[1024px]:hidden"
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
              <SidebarContent
                pendingDraftCount={drafts.length}
                onClearData={() => setShowClearConfirm(true)}
                onAssistantProviders={() => setAssistantSetupOpen(true)}
                onAccessCredentials={
                  canManageAccessCredentials
                    ? () => setShowAccessCredentials(true)
                    : undefined
                }
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {canManageAccessCredentials ? (
        <AccessCredentialsDialog
          open={showAccessCredentials}
          onOpenChange={setShowAccessCredentials}
        />
      ) : null}

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
