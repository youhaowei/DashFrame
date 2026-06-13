import { useAssistantStore } from "@/lib/stores/assistant-store";
import { Button } from "@wystack/ui";
import { CloseIcon, SparklesIcon } from "@wystack/ui-icons";

import { AssistantEmptyState } from "./AssistantEmptyState";
import { useArtifactContext } from "./artifact-context";

/**
 * The assistant panel body — rendered inside the shared right Dock, which owns
 * the panel chrome (surface, width).
 *
 * Slack-assistant shape: summonable, contextual to the current artifact,
 * dismissable. The artifact (center) stays primary; this is an input method
 * onto it, not a transcript the app is built around. Live agent content is
 * gated on the pi-agent — this ships the *shell* (toggle, context binding, the
 * empty conversation surface).
 */
export function AssistantSidebar() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden"
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
