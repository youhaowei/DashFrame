import type { Field } from "@dashframe/types";
import { getFieldSensitivity } from "@dashframe/types";
import { Badge } from "@stdui/react";

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
    return (
      <button
        type="button"
        title={`${suggestedReasons.join("; ")} — click to confirm as sensitive`}
        onClick={onConfirmSuggestion}
        className="shrink-0 cursor-pointer"
      >
        <Badge variant="soft" color="warning" className="hover:opacity-80">
          Likely sensitive
        </Badge>
      </button>
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
