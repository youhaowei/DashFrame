import { cn } from "../lib/utils";
import { ActionButton, type ItemAction } from "./ActionButton";

export type { ItemAction };

export interface ActionGroupProps {
  actions: ItemAction[];
  className?: string;
  compact?: boolean;
}

/**
 * ActionGroup - Renders a group of action buttons from definitions
 *
 * Standard component for rendering groups of action buttons in DashFrame.
 * Uses ActionButton internally to maintain consistency across the app.
 *
 * @example
 * ```tsx
 * <ActionGroup
 *   actions={[
 *     { label: 'Save', onClick: handleSave, icon: Save },
 *     { label: 'Cancel', onClick: handleCancel, variant: 'outline' }
 *   ]}
 * />
 * ```
 */
export function ActionGroup({
  actions,
  className,
  compact = false,
}: ActionGroupProps) {
  if (actions.length === 0) return null;

  return (
    <div
      className={cn("flex shrink-0 flex-wrap items-center gap-2", className)}
    >
      {actions.map((action, index) => (
        <ActionButton key={index} {...action} compact={compact} />
      ))}
    </div>
  );
}
