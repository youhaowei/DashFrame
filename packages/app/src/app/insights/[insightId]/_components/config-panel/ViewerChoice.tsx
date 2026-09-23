import { WorkbenchCheckbox } from "@dashframe/ui";
import { Tooltip } from "@wystack/ui-react";
import { Eye } from "lucide-react";

/**
 * Marks a chip that viewers can change. The eye alone is not self-explanatory,
 * so it names the permission on hover and to assistive technology.
 */
export function ViewerChoiceMark({ label }: { label: string }) {
  return (
    <Tooltip content={label}>
      <Eye
        role="img"
        aria-label={label}
        className="h-3.5 w-3.5 shrink-0 text-neutral-fg-subtle"
      />
    </Tooltip>
  );
}

export function ViewerChoiceCheckbox({
  checked,
  onCheckedChange,
  kind,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  kind: "fields" | "metrics";
}) {
  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <WorkbenchCheckbox
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        Viewers can show or hide
      </label>
      <p className="pl-6 text-[11px] leading-4 text-neutral-fg-subtle">
        Viewers pick which of the marked {kind} the report shows.
      </p>
    </div>
  );
}
