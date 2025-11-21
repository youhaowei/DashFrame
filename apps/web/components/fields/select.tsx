"use client";

import { Field, FieldLabel, Select as SelectPrimitive, SelectContent, SelectTrigger, SelectValue, CheckIcon, cn } from "@dashframe/ui";
import * as SelectPrimitiveParts from "@radix-ui/react-select";

interface SelectOption {
  label: string;
  value: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder = "Select an option...",
  className,
}: SelectProps) {
  return (
    <Field className={className}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <SelectPrimitive value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectPrimitiveParts.Item
              key={option.value}
              value={option.value}
              className={cn(
                "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              )}
            >
              <span className="absolute right-2 flex size-3.5 items-center justify-center">
                <SelectPrimitiveParts.ItemIndicator>
                  <CheckIcon className="size-4" />
                </SelectPrimitiveParts.ItemIndicator>
              </span>
              <div className="flex flex-col gap-0.5">
                <SelectPrimitiveParts.ItemText>
                  {option.label}
                </SelectPrimitiveParts.ItemText>
                {option.description && (
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {option.description}
                  </span>
                )}
              </div>
            </SelectPrimitiveParts.Item>
          ))}
        </SelectContent>
      </SelectPrimitive>
    </Field>
  );
}
