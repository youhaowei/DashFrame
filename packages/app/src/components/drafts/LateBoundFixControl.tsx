import { Button, Input, Label } from "@wystack/ui-react";
import { useId, useState } from "react";

export interface LateBoundEntry {
  commandIndex: number;
  path: string;
  jsonPath: string;
  kind: string;
  label?: string;
  refType: "column" | "category" | "placeholder" | "unknown";
}

const reasons: Record<
  Exclude<LateBoundEntry["refType"], "placeholder">,
  string
> = {
  category:
    "This value is held by the access gate and cannot be filled in here.",
  column: "This compares two columns and has no value to fill in.",
  unknown: "This value cannot be filled in here.",
};

export function LateBoundFixControl({
  entry,
  disabled,
  onApply,
}: {
  entry: LateBoundEntry;
  disabled?: boolean;
  /** Resolves true only when the bind landed; false leaves the input intact. */
  onApply: (value: string) => Promise<boolean>;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [applying, setApplying] = useState(false);

  if (entry.refType !== "placeholder") {
    return (
      <p className="text-xs leading-relaxed text-neutral-fg-subtle">
        {reasons[entry.refType]}
      </p>
    );
  }

  const apply = async () => {
    setApplying(true);
    try {
      // Clear ONLY on success. Clearing unconditionally wiped the reviewer's
      // typed value on a rejected bind, so a failure looked like it applied and
      // the value had to be retyped from memory.
      if (await onApply(value)) setValue("");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="text-xs">
        Value{entry.label ? ` — ${entry.label}` : ""}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={value}
          disabled={disabled || applying}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void apply();
          }}
        />
        <Button
          size="sm"
          label="Apply"
          disabled={disabled || applying}
          onClick={() => void apply()}
        />
      </div>
    </div>
  );
}
