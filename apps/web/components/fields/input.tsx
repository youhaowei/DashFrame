"use client";

import { Label } from "../ui/label";
import { Input as InputPrimitive } from "../ui/input";

interface InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: InputProps) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs font-medium text-foreground">
        {label}
      </Label>
      <InputPrimitive
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
