"use client";

import {
  cn,
  Field,
  FieldLabel,
  SelectContent,
  SelectItem,
  Select as SelectPrimitive,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui";

interface SelectOption {
  label: string;
  value: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

interface SelectProps {
  label?: string;
  /** Optional React node to render alongside the label (e.g., warning badges, help icons) */
  labelAddon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  onClear?: () => void;
  /** Error message to display below the field */
  error?: string;
}

export function Select({
  label,
  labelAddon,
  value,
  onChange,
  options,
  placeholder = "Select an option...",
  className,
  onClear,
  error,
}: SelectProps) {
  const selectedOption = options.find((option) => option.value === value);
  const items = options.map((option) => ({
    label: option.label,
    value: option.value,
  }));

  return (
    <Field className={className}>
      {(label || labelAddon) && (
        <div className="flex items-center justify-between gap-2">
          {label && <FieldLabel>{label}</FieldLabel>}
          {labelAddon}
        </div>
      )}
      <SelectPrimitive
        items={items}
        value={value}
        onValueChange={(v) => onChange(typeof v === "string" ? v : "")}
      >
        <SelectTrigger
          className={cn(
            "w-full",
            error && "border-palette-danger focus:ring-palette-danger",
          )}
        >
          <SelectValue placeholder={placeholder}>
            {selectedOption?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              label={option.label}
              disabled={option.disabled}
              className={cn("pr-8 focus:bg-neutral-bg-emphasis")}
            >
              <div className="flex items-start gap-2">
                {option.icon && (
                  <option.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-fg-subtle" />
                )}
                <div className="flex flex-col gap-0.5">
                  <span>{option.label}</span>
                  {option.description && (
                    <span className="text-[10px] font-normal text-neutral-fg-subtle">
                      {option.description}
                    </span>
                  )}
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </SelectPrimitive>
      {error && <p className="mt-1 text-xs text-palette-danger">{error}</p>}
    </Field>
  );
}
