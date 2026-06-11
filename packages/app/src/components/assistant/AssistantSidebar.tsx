import { useAssistantStore } from "@/lib/stores/assistant-store";
import { Button, cn } from "@wystack/ui";
import { CloseIcon, ExternalLinkIcon, SparklesIcon } from "@wystack/ui-icons";

import { AssistantEmptyState } from "./AssistantEmptyState";
import { useArtifactContext } from "./artifact-context";

/**
 * The assistant sidebar shell — the right region of the three-region layout.
 *
 * Slack-assistant shape: summonable, contextual to the current artifact,
 * dismissable. The artifact (center) stays primary; this is an input method
 * onto it, not a transcript the app is built around. Live agent content is
 * gated on the pi-agent — this ships the *shell* (dock, toggle, context
 * binding, the empty conversation surface).
 *
 * Two presentations, driven by the persisted `dock` preference:
 * - `docked` — the panel reflows alongside the artifact (the shell handles the
 *   width; this component renders the panel body only).
 * - `floating` — an overlay anchored to the right edge that hovers over the
 *   artifact without reflowing it.
 */
export function AssistantSidebar({
  presentation,
}: {
  /**
   * How to present the panel. Decoupled from the persisted `dock` preference so
   * the shell can force an overlay on narrow widths (no room to reflow) even
   * when the user prefers docked.
   */
  presentation: "docked" | "floating";
}) {
  if (presentation === "floating") {
    return (
      <div className="pointer-events-none fixed inset-y-0 right-0 z-30 flex items-stretch p-3">
        <div
          className="pointer-events-auto flex w-[clamp(20rem,28vw,30rem)] flex-col overflow-hidden rounded-2xl border border-neutral-border bg-neutral-bg/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-neutral-bg/85"
          role="complementary"
          aria-label="Assistant"
        >
          <AssistantPanelBody />
        </div>
      </div>
    );
  }

  // Docked: fill the rail the shell reserves for us.
  return (
    <div
      className="flex h-full flex-col overflow-hidden border-l border-neutral-border/60 bg-neutral-bg/80"
      role="complementary"
      aria-label="Assistant"
    >
      <AssistantPanelBody />
    </div>
  );
}

function AssistantPanelBody() {
  const artifact = useArtifactContext();
  const close = useAssistantStore((s) => s.close);
  const dock = useAssistantStore((s) => s.dock);
  const toggleDock = useAssistantStore((s) => s.toggleDock);

  return (
    <>
      {/* Header — names the bound artifact; the assistant is contextual to it. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-border/60 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-palette-primary/10 text-palette-primary">
          <SparklesIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-semibold tracking-tight text-neutral-fg">
            Assistant
          </span>
          <span className="truncate text-[11px] text-neutral-fg-subtle">
            {artifact ? artifact.title : "No artifact in focus"}
          </span>
        </div>
        <Button
          variant="ghost"
          icon={ExternalLinkIcon}
          iconOnly
          size="sm"
          label={dock === "docked" ? "Undock (float)" : "Dock to right"}
          tooltip={dock === "docked" ? "Undock (float)" : "Dock to right"}
          onClick={toggleDock}
          className={cn(
            "size-7 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg",
            dock === "floating" && "text-palette-primary",
          )}
        />
        <Button
          variant="ghost"
          icon={CloseIcon}
          iconOnly
          size="sm"
          label="Dismiss assistant"
          tooltip="Dismiss (⌘J)"
          onClick={close}
          className="size-7 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg"
        />
      </header>

      <div className="min-h-0 flex-1">
        <AssistantEmptyState artifact={artifact} />
      </div>
    </>
  );
}
