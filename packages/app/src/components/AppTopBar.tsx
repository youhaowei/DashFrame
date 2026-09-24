import { AppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { CollapsedShelf } from "@/components/shelf/CollapsedShelf";
import { DESKTOP_NAV_TRAFFIC_LIGHTS_OVER_NAV_CLASS } from "@/components/shell/layout-constants";
import { useRegisteredTopBarTabs } from "@/components/shell/topbar-tabs";
import { usePlatform } from "@/lib/platform";
import { useShellStore } from "@/lib/stores/shell-store";
import {
  useCommandPalette,
  useCommandPaletteShortcutLabel,
} from "@/components/shell/command-palette-store";
import { WorkbenchTabs } from "@dashframe/ui";
import { Button, TopBar, cn } from "@wystack/ui-react";
import {
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
} from "@wystack/ui-react/icons";

/**
 * Window top bar — the macOS title-bar replacement. Sits above the content,
 * beside the full-height nav; holds the left-nav and appearance-panel toggles,
 * the page's breadcrumb and tabs, and (in the Electron renderer) acts as the
 * draggable region.
 *
 * On macOS desktop the traffic lights sit over the nav while it is open, so
 * the bar reserves room for them (`w-16`) only while the nav is closed or
 * hidden below the desktop breakpoint. The reservation animates with the nav.
 *
 * The drag behaviour is supplied by the `titlebar-drag-region` class, whose
 * `-webkit-app-region` rules live in a raw <style> in the Electron host's
 * index.html (Lightning CSS strips that property). Buttons opt out of drag
 * automatically via the `button { app-region: no-drag }` rule there.
 *
 * The current page's breadcrumb (see `useAppBreadcrumbs`) and workbench tabs
 * (see `useTopBarTabs`) sit after the nav toggle; the tabs stand in for the
 * breadcrumb's current page. They ride in the left region rather than TopBar's `center` slot:
 * that slot's wrapper cannot shrink below its content, so an overflowing
 * strip would push the bar wider instead of scrolling and offering the
 * finder. The strip is content-sized, so the rest of the bar stays a drag
 * handle; each tab is a button and opts out of dragging.
 */
export function AppTopBar() {
  const { hasInsetTrafficLights } = usePlatform();

  const leftNavOpen = useShellStore((s) => s.leftNavOpen);
  const toggleLeftNav = useShellStore((s) => s.toggleLeftNav);
  const appearanceOpen = useShellStore((s) => s.contextAppearanceOpen);
  const toggleAppearance = useShellStore((s) => s.toggleContextAppearance);
  const tabs = useRegisteredTopBarTabs();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const paletteShortcut = useCommandPaletteShortcutLabel();

  return (
    <TopBar
      className="titlebar-drag-region shrink-0"
      height={40}
      left={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {hasInsetTrafficLights && (
            <div
              data-testid="traffic-light-spacer"
              className={cn(
                "w-16 shrink-0 transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
                leftNavOpen && DESKTOP_NAV_TRAFFIC_LIGHTS_OVER_NAV_CLASS,
              )}
              aria-hidden
            />
          )}
          {/* Toggles the desktop nav Dock (itself `hidden lg:flex`); below lg the
              nav is a dialog with its own menu button, so hide this to avoid a
              control that appears to do nothing on mobile. */}
          <Button
            variant="ghost"
            icon={leftNavOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
            iconOnly
            label={leftNavOpen ? "Hide sidebar" : "Show sidebar"}
            tooltip={leftNavOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={toggleLeftNav}
            className="hidden h-7 w-7 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg lg:flex"
          />
          {/* The nav's search row, while the nav is out of view: collapsed on
              desktop, a drawer below the desktop breakpoint. */}
          <Button
            variant="ghost"
            icon={SearchIcon}
            iconOnly
            label="Search"
            tooltip={`Search (${paletteShortcut})`}
            onClick={() => openPalette(true)}
            className={cn(
              "h-7 w-7 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg",
              leftNavOpen && "lg:hidden",
            )}
          />
          {/* While the sidebar is hidden, its shelf lives here. */}
          {!leftNavOpen && (
            <CollapsedShelf className="hidden shrink-0 lg:grid" />
          )}
          <AppBreadcrumbs
            beforeTabs={tabs !== null}
            className={tabs ? "max-w-[45%] shrink-0" : "shrink"}
          />
          {tabs && (
            <WorkbenchTabs
              label={tabs.label}
              tabs={tabs.tabs}
              activeId={tabs.activeId}
              onSelect={tabs.onSelect}
              panelId={tabs.panelId}
              findLabel={tabs.findLabel}
              findEmptyLabel={tabs.findEmptyLabel}
              className="min-w-0 shrink"
            />
          )}
        </div>
      }
      right={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            icon={PaletteIcon}
            iconOnly
            label={
              appearanceOpen ? "Hide appearance panel" : "Show appearance panel"
            }
            tooltip="Appearance"
            onClick={toggleAppearance}
            active={appearanceOpen}
            className={cn(
              "h-7 w-7",
              !appearanceOpen && "text-neutral-fg-subtle hover:text-neutral-fg",
            )}
          />
        </div>
      }
    />
  );
}
