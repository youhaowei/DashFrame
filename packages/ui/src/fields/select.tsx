"use client";

import { CloseIcon } from "@stdui/icons";
import {
  Button,
  cn,
  Field,
  FieldLabel,
  SelectContent,
  SelectItem,
  Select as SelectPrimitive,
  SelectTrigger,
  SelectValue,
} from "@stdui/react";

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
  return (
    <Field className={className}>
      {(label || labelAddon) && (
        <div className="flex items-center justify-between gap-2">
          {label && <FieldLabel>{label}</FieldLabel>}
          {labelAddon}
        </div>
      )}
      <div className="flex items-center gap-2">
        <SelectPrimitive value={value || undefined} onValueChange={onChange}>
          <SelectTrigger
            className={cn(
              "w-full",
              error && "border-red-500 focus:ring-red-500",
            )}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-neutral-bg-emphasis focus:text-neutral-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
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
        {onClear && value && (
          <Button
            label="Clear selection"
            icon={CloseIcon}
            iconOnly
            variant="ghost"
            color="secondary"
            size="sm"
            onClick={onClear}
            className="shrink-0"
          />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </Field>
  );
}
