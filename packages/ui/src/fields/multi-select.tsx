"use client";

import type { MultiSelectOption } from "@stdui/react";
import {
  Field,
  FieldLabel,
  MultiSelect as MultiSelectPrimitive,
} from "@stdui/react";

interface MultiSelectProps {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function MultiSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select items...",
  disabled = false,
  className,
}: MultiSelectProps) {
  return (
    <Field className={className}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <MultiSelectPrimitive
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
      />
    </Field>
  );
}
