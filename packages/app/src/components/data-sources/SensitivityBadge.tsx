import type { Field } from "@dashframe/types";
import { getFieldSensitivity } from "@dashframe/types";
import { Badge } from "@wystack/ui";

interface SensitivityBadgeProps {
  field: Field;
  /** Classifier suggestion reasons, when the field is unclassified */
  suggestedReasons: string[];
  /** One-click confirm of the classifier suggestion */
  onConfirmSuggestion: () => void;
}

/**
 * Privacy badge for a field row. Single rendering of the sensitivity states
 * shared by every field list:
 * - sensitive → danger badge carrying the stored why
 * - unclassified + suggestion → clickable warning badge (confirm = mark)
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
    // Clickable confirm affordance. Built from the composed Badge (not a raw
    // primitive — those are construction blocks internal to @wystack/ui) made
    // interactive via role/tabIndex + keyboard activation.
    return (
      <Badge
        variant="soft"
        color="warning"
        role="button"
        tabIndex={0}
        title={`${suggestedReasons.join("; ")} — click to confirm as sensitive`}
        onClick={onConfirmSuggestion}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onConfirmSuggestion();
          }
        }}
        className="shrink-0 cursor-pointer"
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
