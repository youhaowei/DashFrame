import { useAssistantStore } from "@/lib/stores/assistant-store";
import {
  RIGHT_DOCK_MAX_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  useShellStore,
} from "@/lib/stores/shell-store";
import { Dock } from "@wystack/ui";
import { ThemePanel } from "@wystack/ui/views";

import { AssistantSidebar } from "./assistant/AssistantSidebar";

/**
 * The single shared right panel. Holds the appearance panel or the assistant —
 * never both (the right-dock coordinator enforces mutual exclusion). Geometry
 * (separate vs. overlay, width) is global: set once on the Dock, identical for
 * whichever content is showing, and resizable by dragging the inner edge.
 */
export function RightDock() {
  const appearanceOpen = useShellStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useShellStore((s) => s.setRightPanelOpen);
  const assistantOpen = useAssistantStore((s) => s.isOpen);

  const mode = useShellStore((s) => s.rightDockMode);
  const width = useShellStore((s) => s.rightDockWidth);
  const setWidth = useShellStore((s) => s.setRightDockWidth);

  const open = appearanceOpen || assistantOpen;

  // The Dock owns the panel chrome for BOTH contents — they render bare inside
  // it, so switching content never changes the surface or its size.
  const showAppearance = appearanceOpen;

  return (
    <Dock
      side="right"
      open={open}
      mode={mode}
      width={width}
      resizable
      onResize={setWidth}
      minExtent={RIGHT_DOCK_MIN_WIDTH}
      maxExtent={RIGHT_DOCK_MAX_WIDTH}
      aria-label={showAppearance ? "Appearance" : "Assistant"}
    >
      {showAppearance ? (
        <ThemePanel
          isOpen={appearanceOpen}
          onClose={() => setRightPanelOpen(false)}
          bare
        />
      ) : (
        <AssistantSidebar />
      )}
    </Dock>
  );
}
