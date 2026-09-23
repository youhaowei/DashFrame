import { useRegisteredTopBarTabs } from "@/components/shell/topbar-tabs";
import { usePlatform } from "@/lib/platform";
import { useShellStore } from "@/lib/stores/shell-store";
import { WorkbenchTabs } from "@dashframe/ui";
import { Button, TopBar, cn } from "@wystack/ui-react";
import {
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "@wystack/ui-react/icons";

/** Width reserved for the macOS traffic lights when the title bar is hidden. */
const TRAFFIC_LIGHT_SPACER_PX = 64;

/**
 * Full-width window top bar — the macOS title-bar replacement. Spans above both
 * the nav and the content, holds the left-nav and appearance-panel toggles, and
 * (in the Electron renderer) acts as the draggable region.
 *
 * The drag behaviour is supplied by the `titlebar-drag-region` class, whose
 * `-webkit-app-region` rules live in a raw <style> in the Electron host's
 * index.html (Lightning CSS strips that property). Buttons opt out of drag
 * automatically via the `button { app-region: no-drag }` rule there.
 *
 * The current page's workbench tabs (see `useTopBarTabs`) sit after the nav
 * toggle. They ride in the left region rather than TopBar's `center` slot:
 * that slot's wrapper cannot shrink below its content, so an overflowing
 * strip would push the bar wider instead of scrolling and offering the
 * finder. The strip is content-sized, so the rest of the bar stays a drag
 * handle; each tab is a button and opts out of dragging.
 */
export function AppTopBar() {
  const { isElectron, isMacOS } = usePlatform();
  const macDesktop = isElectron && isMacOS;

  const leftNavOpen = useShellStore((s) => s.leftNavOpen);
  const toggleLeftNav = useShellStore((s) => s.toggleLeftNav);
  const appearanceOpen = useShellStore((s) => s.contextAppearanceOpen);
  const toggleAppearance = useShellStore((s) => s.toggleContextAppearance);
  const tabs = useRegisteredTopBarTabs();

  return (
    <TopBar
      className="titlebar-drag-region shrink-0 px-[var(--surface-inset)]"
      height={40}
      left={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {macDesktop && (
            <div
              className="shrink-0"
              style={{ width: TRAFFIC_LIGHT_SPACER_PX }}
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
