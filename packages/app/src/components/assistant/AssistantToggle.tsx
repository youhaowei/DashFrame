import { useAssistantStore } from "@/lib/stores/assistant-store";
import { Button } from "@wystack/ui";
import { SparklesIcon } from "@wystack/ui-icons";

/**
 * Discoverable summon for the assistant. The keyboard path (⌘J) is invisible to
 * new users, so a visible affordance lives in the shell. Reflects open state via
 * `aria-pressed` and color.
 */
export function AssistantToggle({ className }: { className?: string }) {
  const isOpen = useAssistantStore((s) => s.isOpen);
  const toggle = useAssistantStore((s) => s.toggle);

  return (
    <Button
      variant={isOpen ? "solid" : "outline"}
      color="primary"
      icon={SparklesIcon}
      iconOnly
      label={isOpen ? "Hide assistant" : "Open assistant"}
      tooltip={isOpen ? "Hide assistant (⌘J)" : "Open assistant (⌘J)"}
      onClick={toggle}
      aria-pressed={isOpen}
      className={className}
    />
  );
}
