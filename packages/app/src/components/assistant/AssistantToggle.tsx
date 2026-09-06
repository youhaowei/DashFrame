import { useHostQuery } from "@/data/host";

import { Button, cn } from "@wystack/ui-react";
import { SparklesIcon } from "@wystack/ui-react/icons";

import { useAssistantStore } from "@/lib/stores/assistant-store";

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
  const configsResult = useHostQuery("listAssistantProviderConfigs");
  const configsLoaded =
    configsResult.data !== undefined && !configsResult.isLoading;
  const configsFailed = configsResult.isError;
  // A failed refetch keeps the last successful `data`, so this stays true on a
  // transient error over a working list — the rail is only withheld when the
  // query has never succeeded and there is genuinely nothing to show.
  const assistantAvailable = (configsResult.data?.length ?? 0) > 0;
  // An empty array is a *known* answer: the query succeeded and there are no
  // providers. Only `undefined` means we never learned anything.
  const configsUnknown = configsResult.data === undefined;
  const assistantOpen = isOpen && assistantAvailable;
  let label = "Set up assistant";
  if (assistantAvailable) {
    label = assistantOpen ? "Hide assistant" : "Open assistant";
  } else if (configsFailed && configsUnknown) {
    label = "Retry assistant configuration";
  }

  function handleClick() {
    // Failed having never learned the answer: we don't know whether a provider
    // exists, so neither opening the rail nor opening setup is honest. Retry
    // instead — that keeps the assistant reachable without presenting a
    // surface that cannot work. A cached empty list is not this case; it is a
    // known-unconfigured state, and setup must stay reachable through it.
    if (!assistantAvailable && configsFailed && configsUnknown) {
      configsResult.refetch().catch(() => undefined);
      return;
    }
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
      disabled={!configsLoaded && !configsFailed}
      onClick={handleClick}
      active={assistantOpen}
      className={cn(
        !assistantOpen && "text-neutral-fg-subtle hover:text-neutral-fg",
        className,
      )}
    />
  );
}
