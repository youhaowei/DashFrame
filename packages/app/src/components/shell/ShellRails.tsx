import { useAssistantStore } from "@/lib/stores/assistant-store";
import {
  ASSISTANT_RAIL_MAX_WIDTH,
  ASSISTANT_RAIL_MIN_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  useShellStore,
} from "@/lib/stores/shell-store";
import { Dock, cn } from "@wystack/ui";
import { ThemePanel } from "@wystack/ui/views";

import { AssistantSidebar } from "../assistant/AssistantSidebar";
import { useContextPanelSections } from "./context-panel-outlet";

const DESKTOP_NAV_WIDTH = 240;
const SHELL_GAP_WIDTH = 8;
const CONTEXT_MERGE_STAGE_WIDTH = 920;
const CONTEXT_COLLAPSE_STAGE_WIDTH = 680;

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
  assistantWidth,
  contextOpen,
  assistantOpen,
  openSiblings,
}: {
  shellWidth: number;
  navWidth: number;
  contextWidth: number;
  assistantWidth: number;
  contextOpen: boolean;
  assistantOpen: boolean;
  openSiblings: number;
}): number {
  if (shellWidth <= 0) return Number.POSITIVE_INFINITY;

  let width = shellWidth - navWidth - gapWidth(openSiblings);
  if (contextOpen) width -= contextWidth;
  if (assistantOpen) width -= assistantWidth;
  return width;
}

interface ShellRailsProps {
  shellWidth: number;
}

export function ShellRails({ shellWidth }: ShellRailsProps) {
  const sections = useContextPanelSections();
  const leftNavOpen = useShellStore((s) => s.leftNavOpen);
  const appearanceOpen = useShellStore((s) => s.contextAppearanceOpen);
  const setAppearanceOpen = useShellStore((s) => s.setContextAppearanceOpen);
  const contextWidth = useShellStore((s) => s.contextPanelWidth);
  const setContextWidth = useShellStore((s) => s.setContextPanelWidth);
  const assistantWidth = useShellStore((s) => s.assistantRailWidth);
  const setAssistantWidth = useShellStore((s) => s.setAssistantRailWidth);
  const assistantOpen = useAssistantStore((s) => s.isOpen);

  const contextIntentOpen = appearanceOpen || sections.length > 0;
  const desktopNavInFlow = leftNavOpen && shellWidth >= 1024;
  const navWidth = desktopNavInFlow ? DESKTOP_NAV_WIDTH : 0;
  const openWithContext = countOpenSiblings(
    desktopNavInFlow,
    contextIntentOpen,
    assistantOpen,
  );
  const stageWidthWithContext = getStageWidth({
    shellWidth,
    navWidth,
    contextWidth,
    assistantWidth,
    contextOpen: contextIntentOpen,
    assistantOpen,
    openSiblings: openWithContext,
  });

  const contextMerged = stageWidthWithContext < CONTEXT_MERGE_STAGE_WIDTH;
  const contextAutoCollapsed =
    contextIntentOpen && stageWidthWithContext < CONTEXT_COLLAPSE_STAGE_WIDTH;
  const contextOpen = contextIntentOpen && !contextAutoCollapsed;

  const openAfterContext = countOpenSiblings(
    desktopNavInFlow,
    contextOpen,
    assistantOpen,
  );
  const stageWidthAfterContext = getStageWidth({
    shellWidth,
    navWidth,
    contextWidth,
    assistantWidth,
    contextOpen,
    assistantOpen,
    openSiblings: openAfterContext,
  });
  const assistantNarrowed =
    assistantOpen &&
    stageWidthAfterContext < CONTEXT_COLLAPSE_STAGE_WIDTH &&
    assistantWidth > ASSISTANT_RAIL_MIN_WIDTH;
  let renderedAssistantWidth = assistantWidth;
  if (assistantNarrowed) {
    renderedAssistantWidth = ASSISTANT_RAIL_MIN_WIDTH;
  }

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
        <ContextPanelContent
          appearanceOpen={appearanceOpen}
          onCloseAppearance={() => setAppearanceOpen(false)}
          compact={contextMerged}
        />
      </Dock>

      <Dock
        side="right"
        open={assistantOpen}
        width={renderedAssistantWidth}
        resizable
        onResize={setAssistantWidth}
        minExtent={ASSISTANT_RAIL_MIN_WIDTH}
        maxExtent={ASSISTANT_RAIL_MAX_WIDTH}
        aria-label="Assistant"
      >
        <AssistantSidebar />
      </Dock>
    </>
  );
}

function ContextPanelContent({
  appearanceOpen,
  onCloseAppearance,
  compact,
}: {
  appearanceOpen: boolean;
  onCloseAppearance: () => void;
  compact: boolean;
}) {
  const sections = useContextPanelSections();

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        compact && "text-sm",
      )}
    >
      {appearanceOpen && (
        <section className="min-h-0 flex-1 border-b border-neutral-border/60">
          <ThemePanel
            isOpen={appearanceOpen}
            onClose={onCloseAppearance}
            bare
          />
        </section>
      )}
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
