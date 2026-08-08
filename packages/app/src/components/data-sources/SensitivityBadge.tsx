import type { Field } from "@dashframe/types";
import { getFieldSensitivity } from "@dashframe/types";
import { Badge } from "@wystack/ui-react";

interface SensitivityBadgeProps {
  field: Field;
  /** Classifier suggestion reasons, when the field is unclassified */
  suggestedReasons: string[];
  /** One-click confirm of the classifier suggestion, when the surface supports it */
  onConfirmSuggestion?: () => void;
}

/**
 * Privacy badge for a field row. Single rendering of the sensitivity states
 * shared by every field list:
 * - sensitive → danger badge carrying the stored why
 * - unclassified + suggestion → clickable warning badge when onConfirmSuggestion is supplied; otherwise read-only
 * - unclassified → outline badge (restricted until cleared)
 * - cleared → nothing
 */
export function SensitivityBadge({
  field,
  suggestedReasons,
  onConfirmSuggestion,
}: SensitivityBadgeProps) {
  const sensitivity = getFieldSensitivity(field);

  if (sensitivity === "cleared") return null;

  if (sensitivity === "sensitive") {
    return (
      <Badge
        variant="soft"
        color="danger"
        title={field.sensitivityReason}
        className="shrink-0"
      >
        Sensitive
      </Badge>
    );
  }

  if (suggestedReasons.length > 0) {
    const interactiveProps = onConfirmSuggestion
      ? {
          role: "button",
          tabIndex: 0,
          onClick: onConfirmSuggestion,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              // Ignore auto-repeat so holding Enter/Space doesn't confirm repeatedly.
              if (e.repeat) return;
              onConfirmSuggestion();
            }
          },
        }
      : {};

    // Surfaces that can confirm the suggestion opt into an interactive
    // affordance. Read-only surfaces reuse the same composed badge without
    // advertising an action they cannot perform.
    //
    // This relies on Badge forwarding arbitrary props to its root DOM node.
    // @wystack/ui-react's Badge renders `<div className={...} {...props} />`
    // (libs/.../primitives/badge.tsx), so role/tabIndex/onKeyDown/onClick reach
    // the DOM — keyboard nav and SR announcement work. If Badge ever stops
    // spreading ...rest, this affordance must move to an interactive primitive.
    return (
      <Badge
        variant="soft"
        color="warning"
        title={
          onConfirmSuggestion
            ? `${suggestedReasons.join("; ")} — click to confirm as sensitive`
            : suggestedReasons.join("; ")
        }
        {...interactiveProps}
        className={onConfirmSuggestion ? "shrink-0 cursor-pointer" : "shrink-0"}
      >
        Likely sensitive
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      color="secondary"
      title="Treated as sensitive until cleared"
      className="shrink-0"
    >
      Unclassified
    </Badge>
  );
}
