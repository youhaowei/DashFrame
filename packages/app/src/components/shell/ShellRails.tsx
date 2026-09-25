import { Dock, cn } from "@wystack/ui-react";
import { useEffect, useState } from "react";

import {
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  useShellStore,
} from "@/lib/stores/shell-store";

import {
  type ContextPanelSection,
  useContextPanelSections,
} from "./context-panel-outlet";
import { DESKTOP_NAV_BREAKPOINT, DESKTOP_NAV_WIDTH } from "./layout-constants";

const SHELL_GAP_WIDTH = 8;
const CONTEXT_MERGE_STAGE_WIDTH = 920;
const RAIL_PRESSURE_ENTER_STAGE_WIDTH = 600;
const RAIL_PRESSURE_EXIT_STAGE_WIDTH = 640;

function gapWidth(openSiblings: number): number {
  return Math.max(0, openSiblings) * SHELL_GAP_WIDTH;
}

function countOpenSiblings(...items: boolean[]): number {
  return items.filter(Boolean).length;
}

function getStageWidth({
  shellWidth,
  navWidth,
  contextWidth,
  contextOpen,
  openSiblings,
}: {
  shellWidth: number;
  navWidth: number;
  contextWidth: number;
  contextOpen: boolean;
  openSiblings: number;
}): number {
  if (shellWidth <= 0) return Number.POSITIVE_INFINITY;

  let width = shellWidth - navWidth - gapWidth(openSiblings);
  if (contextOpen) width -= contextWidth;
  return width;
}

function getRailPressureState(previous: boolean, stageWidth: number): boolean {
  if (stageWidth < RAIL_PRESSURE_ENTER_STAGE_WIDTH) return true;
  if (stageWidth > RAIL_PRESSURE_EXIT_STAGE_WIDTH) return false;
  return previous;
}

interface ShellRailsProps {
  shellWidth: number;
}

export function ShellRails({ shellWidth }: ShellRailsProps) {
  const sections = useContextPanelSections();
  const [contextAutoCollapsedState, setContextAutoCollapsed] = useState(false);
  const leftNavOpen = useShellStore((s) => s.leftNavOpen);
  const contextWidth = useShellStore((s) => s.contextPanelWidth);
  const setContextWidth = useShellStore((s) => s.setContextPanelWidth);

  const contextIntentOpen = sections.length > 0;
  const desktopNavInFlow = leftNavOpen && shellWidth >= DESKTOP_NAV_BREAKPOINT;
  const navWidth = desktopNavInFlow ? DESKTOP_NAV_WIDTH : 0;
  const openWithContext = countOpenSiblings(
    desktopNavInFlow,
    contextIntentOpen,
  );
  const stageWidthWithContext = getStageWidth({
    shellWidth,
    navWidth,
    contextWidth,
    contextOpen: contextIntentOpen,
    openSiblings: openWithContext,
  });

  const contextMerged = stageWidthWithContext < CONTEXT_MERGE_STAGE_WIDTH;
  const nextContextAutoCollapsed = contextIntentOpen
    ? getRailPressureState(contextAutoCollapsedState, stageWidthWithContext)
    : false;
  const contextOpen = contextIntentOpen && !nextContextAutoCollapsed;

  useEffect(() => {
    if (contextAutoCollapsedState === nextContextAutoCollapsed) return;
    // oxlint-disable-next-line react-hooks-js/set-state-in-effect -- hysteresis follows ResizeObserver measurements; the state transition is the buffer
    setContextAutoCollapsed(nextContextAutoCollapsed);
  }, [contextAutoCollapsedState, nextContextAutoCollapsed]);

  return (
    <>
      <Dock
        side="right"
        open={contextOpen}
        width={contextWidth}
        resizable
        onResize={setContextWidth}
        minExtent={CONTEXT_PANEL_MIN_WIDTH}
        maxExtent={CONTEXT_PANEL_MAX_WIDTH}
        aria-label="Context panel"
      >
        <ContextPanelContent sections={sections} compact={contextMerged} />
      </Dock>
    </>
  );
}

function ContextPanelContent({
  sections,
  compact,
}: {
  sections: ContextPanelSection[];
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        compact && "text-sm",
      )}
    >
      {sections.map((section) => (
        <section
          key={section.id}
          className="flex min-h-0 flex-1 flex-col border-t border-neutral-border/60 first:border-t-0"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 px-3">
            <h2 className="flex-1 select-none text-sm font-semibold text-neutral-fg">
              {section.title}
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {section.content}
          </div>
        </section>
      ))}
    </div>
  );
}
