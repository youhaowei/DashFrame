import { usePlatform } from "@/lib/platform";
import { useShellStore } from "@/lib/stores/shell-store";
import { Button, TopBar, cn } from "@wystack/ui";
import {
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "@wystack/ui-icons";

import { AssistantToggle } from "./assistant/AssistantToggle";

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
 */
export function AppTopBar() {
  const { isElectron, isMacOS } = usePlatform();
  const macDesktop = isElectron && isMacOS;

  const leftNavOpen = useShellStore((s) => s.leftNavOpen);
  const toggleLeftNav = useShellStore((s) => s.toggleLeftNav);
  const rightPanelOpen = useShellStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useShellStore((s) => s.toggleRightPanel);

  return (
    <TopBar
      className="titlebar-drag-region shrink-0 px-[var(--surface-inset)]"
      height={40}
      left={
        <div className="flex items-center gap-2">
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
            className="hidden h-7 w-7 text-neutral-fg-subtle hover:text-neutral-fg lg:flex"
          />
        </div>
      }
      right={
        <div className="flex items-center gap-1">
          <AssistantToggle className="h-7 w-7" />
          <Button
            variant="ghost"
            icon={PaletteIcon}
            iconOnly
            label={
              rightPanelOpen ? "Hide appearance panel" : "Show appearance panel"
            }
            tooltip="Appearance"
            onClick={toggleRightPanel}
            active={rightPanelOpen}
            className={cn(
              "h-7 w-7",
              !rightPanelOpen && "text-neutral-fg-subtle hover:text-neutral-fg",
            )}
          />
        </div>
      }
    />
  );
}
