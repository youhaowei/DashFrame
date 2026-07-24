import { useQuery } from "@wystack/client";
import { Button, cn } from "@wystack/ui-react";
import { SparklesIcon } from "@wystack/ui-react/icons";

import { useAssistantStore } from "@/lib/stores/assistant-store";
import { api } from "@/wystack/api";

/**
 * Discoverable summon for the assistant. The keyboard path (⌘J) is invisible to
 * new users, so a visible affordance lives in the shell. A quiet ghost toggle —
 * same visual language as the other top-bar panel toggles — reflecting open
 * state via `aria-pressed` and the primary tint.
 */
export function AssistantToggle({ className }: { className?: string }) {
  const isOpen = useAssistantStore((s) => s.isOpen);
  const close = useAssistantStore((s) => s.close);
  const toggle = useAssistantStore((s) => s.toggle);
  const setSetupOpen = useAssistantStore((s) => s.setSetupOpen);
  const configsResult = useQuery(api.listAssistantProviderConfigs);
  const configsLoaded =
    configsResult.data !== undefined && !configsResult.isLoading;
  const assistantAvailable = (configsResult.data?.length ?? 0) > 0;
  const assistantOpen = isOpen && assistantAvailable;
  let label = "Set up assistant";
  if (assistantAvailable) {
    label = assistantOpen ? "Hide assistant" : "Open assistant";
  }

  function handleClick() {
    if (!assistantAvailable) {
      close();
      setSetupOpen(true);
      return;
    }
    toggle();
  }

  return (
    <Button
      variant="ghost"
      icon={SparklesIcon}
      iconOnly
      label={label}
      tooltip={assistantAvailable ? `${label} (⌘J)` : label}
      disabled={!configsLoaded}
      onClick={handleClick}
      active={assistantOpen}
      className={cn(
        !assistantOpen && "text-neutral-fg-subtle hover:text-neutral-fg",
        className,
      )}
    />
  );
}
