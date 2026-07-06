import { useAssistantStore } from "@/lib/stores/assistant-store";
import { Button, cn } from "@wystack/ui";
import { SparklesIcon } from "@wystack/ui-icons";

/**
 * Discoverable summon for the assistant. The keyboard path (⌘J) is invisible to
 * new users, so a visible affordance lives in the shell. A quiet ghost toggle —
 * same visual language as the other top-bar panel toggles — reflecting open
 * state via `aria-pressed` and the primary tint.
 */
export function AssistantToggle({ className }: { className?: string }) {
  const isOpen = useAssistantStore((s) => s.isOpen);
  const toggle = useAssistantStore((s) => s.toggle);

  return (
    <Button
      variant="ghost"
      icon={SparklesIcon}
      iconOnly
      label={isOpen ? "Hide assistant" : "Open assistant"}
      tooltip={isOpen ? "Hide assistant (⌘J)" : "Open assistant (⌘J)"}
      onClick={toggle}
      active={isOpen}
      className={cn(
        !isOpen && "text-neutral-fg-subtle hover:text-neutral-fg",
        className,
      )}
    />
  );
}
