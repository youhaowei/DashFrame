"use client";

import { useState, useCallback, useMemo } from "react";
import { useForm } from "@tanstack/react-form";
import type { BaseConnector } from "@dashframe/engine";

/**
 * Creates a TanStack Form for a connector's form fields.
 * Uses connector.validate() for validation on submit.
 *
 * @example
 * ```tsx
 * import { notionConnector } from '@dashframe/notion';
 * import { useConnectorForm } from '@/hooks/useConnectorForm';
 *
 * function NotionForm() {
 *   const { form, formFields, execute, isSubmitting, submitError } = useConnectorForm(notionConnector);
 *
 *   const handleConnect = async () => {
 *     const databases = await execute((data) => notionConnector.connect(data));
 *     if (databases) {
 *       // Handle successful connection
 *     }
 *   };
 *
 *   return (
 *     <>
 *       {formFields.map((fieldDef) => (
 *         <form.Field key={fieldDef.name} name={fieldDef.name}>
 *           {(field) => (
 *             <Input
 *               label={fieldDef.label}
 *               type={fieldDef.type}
 *               value={field.state.value}
 *               onChange={(value) => field.handleChange(value)}
 *               placeholder={fieldDef.placeholder}
 *             />
 *           )}
 *         </form.Field>
 *       ))}
 *       <Button onClick={handleConnect} disabled={isSubmitting}>
 *         {isSubmitting ? 'Connecting...' : 'Connect'}
 *       </Button>
 *     </>
 *   );
 * }
 * ```
 */
export function useConnectorForm<T extends BaseConnector>(connector: T) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * Memoize form fields by connector.id (not connector object reference).
   *
   * Trade-off explanation:
   * - Using connector.id as the dependency ensures stable memoization when the
   *   same connector is passed with a new object reference (e.g., after re-render)
   * - This assumes connectors are immutable singletons: a connector with the same
   *   id will always return the same form fields from getFormFields()
   * - If a connector's getFormFields() implementation changes dynamically without
   *   changing its id, this memoization would return stale data
   *
   * This is acceptable because connectors are defined as stateless singletons
   * (see BaseConnector in @dashframe/engine). If dynamic form fields become
   * needed, consider adding a version/hash property to BaseConnector.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  const formFields = useMemo(() => connector.getFormFields(), [connector.id]);

  // Build default values from form field definitions
  const defaultValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of formFields) {
      values[field.name] = "";
    }
    return values;
  }, [formFields]);

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      // Validation happens in execute(), not onSubmit
      return value;
    },
  });

  /**
   * Execute connector action with validated form data.
   * Returns the result if successful, null if validation fails or error occurs.
   *
   * @param action - Async function to execute with form data
   * @returns Result from action, or null if failed
   */
  const execute = useCallback(
    async <R>(
      action: (data: Record<string, unknown>) => Promise<R>,
    ): Promise<R | null> => {
      const values = form.state.values;
      const result = connector.validate(values);

      if (!result.valid && result.errors) {
        // Set per-field errors on the form
        for (const [fieldName, message] of Object.entries(result.errors)) {
          form.setFieldMeta(fieldName, (prev) => ({
            ...prev,
            errors: [message],
          }));
        }
        return null;
      }

      // Clear any previous errors
      for (const fieldDef of formFields) {
        form.setFieldMeta(fieldDef.name, (prev) => ({
          ...prev,
          errors: [],
        }));
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const result = await action(values);
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Operation failed";
        setSubmitError(errorMessage);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [connector, form, formFields],
  );

  /**
   * Clear the submit error.
   */
  const clearError = useCallback(() => {
    setSubmitError(null);
  }, []);

  /**
   * Reset the form to default values and clear errors.
   */
  const reset = useCallback(() => {
    form.reset();
    setSubmitError(null);
  }, [form]);

  return {
    /** TanStack Form instance for rendering fields */
    form,
    /** The connector being used */
    connector,
    /** Form field definitions from connector */
    formFields,
    /** Execute an action with validated form data */
    execute,
    /** Whether an action is currently executing */
    isSubmitting,
    /** Error message from the last failed action */
    submitError,
    /** Clear the submit error */
    clearError,
    /** Reset the form to default values */
    reset,
  };
}

/**
 * Type for the return value of useConnectorForm
 */
export type UseConnectorFormReturn<T extends BaseConnector> = ReturnType<
  typeof useConnectorForm<T>
>;
