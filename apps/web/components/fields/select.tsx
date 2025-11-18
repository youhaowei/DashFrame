"use client";

import { Label } from "../ui/label";
import {
  Select as SelectPrimitive,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
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
    <div className={className}>
      {label && (
        <Label className="mb-2 block text-sm font-medium text-foreground">
          {label}
        </Label>
      )}
      <SelectPrimitive value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectPrimitive>
    </div>
  );
}
