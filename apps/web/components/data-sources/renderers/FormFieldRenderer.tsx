"use client";

import type { FormField } from "@dashframe/engine";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashframe/ui";
import type { ChangeEvent } from "react";

/**
 * Simplified field state interface for rendering.
 * This avoids complex generic types from TanStack Form.
 */
interface FieldState {
  state: {
    value: string;
    meta: {
      errors?: unknown[];
    };
  };
  handleChange: (value: string) => void;
}

interface FormFieldRendererProps {
  /** Field definition from connector */
  fieldDef: FormField;
  /** TanStack Form field instance */
  field: FieldState;
}

/**
 * Renders a single form field using @dashframe/ui components.
 * Receives both the field definition (from connector) and field state (from TanStack Form).
 *
 * @example
 * ```tsx
 * <form.Field name={fieldDef.name}>
 *   {(field) => (
 *     <FormFieldRenderer fieldDef={fieldDef} field={field} />
 *   )}
 * </form.Field>
 * ```
 */
export function FormFieldRenderer({ fieldDef, field }: FormFieldRendererProps) {
  const errors = field.state.meta.errors?.map((e) => ({
    message: String(e),
  }));

  return (
    <Field className="space-y-1">
      {fieldDef.type === "select" ? (
        <>
          <FieldLabel>{fieldDef.label}</FieldLabel>
          <Select value={field.state.value} onValueChange={field.handleChange}>
            <SelectTrigger>
              <SelectValue placeholder={fieldDef.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {fieldDef.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : (
        <>
          <FieldLabel>{fieldDef.label}</FieldLabel>
          <Input
            type={fieldDef.type}
            value={field.state.value}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              field.handleChange(e.target.value)
            }
            placeholder={fieldDef.placeholder}
          />
        </>
      )}
      {fieldDef.hint && <FieldDescription>{fieldDef.hint}</FieldDescription>}
      <FieldError errors={errors} />
    </Field>
  );
}
