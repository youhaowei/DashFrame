"use client";

import { Field, FieldLabel } from "../primitives/field";
import {
  Select as SelectPrimitive,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "../primitives/select";
import { CheckIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import * as SelectPrimitiveParts from "@radix-ui/react-select";

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
      <SelectPrimitive value={value || undefined} onValueChange={onChange}>
        <SelectTrigger
          className={cn("w-full", error && "border-red-500 focus:ring-red-500")}
          onClear={onClear}
          value={value}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectPrimitiveParts.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              )}
            >
              <span className="absolute right-2 flex size-3.5 items-center justify-center">
                <SelectPrimitiveParts.ItemIndicator>
                  <CheckIcon className="size-4" />
                </SelectPrimitiveParts.ItemIndicator>
              </span>
              <div className="flex items-start gap-2">
                {option.icon && (
                  <option.icon className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <div className="flex flex-col gap-0.5">
                  <SelectPrimitiveParts.ItemText>
                    {option.label}
                  </SelectPrimitiveParts.ItemText>
                  {option.description && (
                    <span className="text-muted-foreground text-[10px] font-normal">
                      {option.description}
                    </span>
                  )}
                </div>
              </div>
            </SelectPrimitiveParts.Item>
          ))}
        </SelectContent>
      </SelectPrimitive>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </Field>
  );
}
