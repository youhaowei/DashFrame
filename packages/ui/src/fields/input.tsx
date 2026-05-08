"use client";

import { Field, FieldLabel, Input as InputPrimitive } from "@stdui/react";

interface InputProps {
  label?: string;
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
    <Field className={className}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <InputPrimitive
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );
}
