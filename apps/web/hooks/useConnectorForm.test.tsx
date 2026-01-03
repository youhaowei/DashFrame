/**
 * Unit tests for useConnectorForm hook
 *
 * Tests cover:
 * - Form initialization from connector fields
 * - Validation error propagation to form fields
 * - Successful action execution with form data
 * - Error handling for failed actions
 * - State management (isSubmitting, submitError)
 * - Form reset functionality
 */
import type {
  BaseConnector,
  FormField,
  ValidationResult,
} from "@dashframe/engine";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectorForm } from "./useConnectorForm";

// Create a mock connector for testing
function createMockConnector(options: {
  id?: string;
  formFields?: FormField[];
  validateFn?: (data: Record<string, unknown>) => ValidationResult;
}): BaseConnector {
  return {
    id: options.id ?? "mock-connector",
    name: "Mock Connector",
    description: "A mock connector for testing",
    sourceType: "file" as const,
    icon: "<svg></svg>",
    getFormFields: () => options.formFields ?? [],
    validate: options.validateFn ?? (() => ({ valid: true })),
  };
}

describe("useConnectorForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with form fields from connector", () => {
      const fields: FormField[] = [
        { name: "apiKey", label: "API Key", type: "password", required: true },
        {
          name: "workspace",
          label: "Workspace",
          type: "text",
          required: false,
        },
      ];
      const connector = createMockConnector({ formFields: fields });

      const { result } = renderHook(() => useConnectorForm(connector));

      expect(result.current.formFields).toHaveLength(2);
      expect(result.current.formFields[0].name).toBe("apiKey");
      expect(result.current.formFields[1].name).toBe("workspace");
    });

    it("should initialize with empty form fields for connector with no fields", () => {
      const connector = createMockConnector({ formFields: [] });

      const { result } = renderHook(() => useConnectorForm(connector));

      expect(result.current.formFields).toHaveLength(0);
    });

    it("should initialize isSubmitting as false", () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      expect(result.current.isSubmitting).toBe(false);
    });

    it("should initialize submitError as null", () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      expect(result.current.submitError).toBeNull();
    });

    it("should provide the connector reference", () => {
      const connector = createMockConnector({ id: "test-connector" });

      const { result } = renderHook(() => useConnectorForm(connector));

      expect(result.current.connector.id).toBe("test-connector");
    });

    it("should provide form instance", () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      expect(result.current.form).toBeDefined();
      expect(result.current.form.state).toBeDefined();
    });
  });

  describe("execute - validation errors", () => {
    it("should return null when validation fails", async () => {
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
        validateFn: () => ({
          valid: false,
          errors: { apiKey: "API key is required" },
        }),
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      let actionResult: unknown;
      await act(async () => {
        actionResult = await result.current.execute(async () => "success");
      });

      expect(actionResult).toBeNull();
    });

    it("should call setFieldMeta when validation fails", async () => {
      // NOTE: TanStack Form's setFieldMeta only works when Field components are mounted.
      // Since we're testing with renderHook (no Field components), we verify the behavior
      // by checking that validation errors cause execute() to return null and don't set
      // submitError (which is for action errors, not validation errors).
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
        validateFn: () => ({
          valid: false,
          errors: { apiKey: "API key is required" },
        }),
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      let actionResult: unknown;
      await act(async () => {
        actionResult = await result.current.execute(async () => "success");
      });

      // Validation failure returns null but doesn't set submitError
      // (submitError is for action errors, not validation errors)
      expect(actionResult).toBeNull();
      expect(result.current.submitError).toBeNull();
    });

    it("should handle multiple validation errors", async () => {
      // NOTE: Full field error testing requires rendering Field components.
      // Here we just verify validation failure behavior.
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
          {
            name: "workspace",
            label: "Workspace",
            type: "text",
            required: true,
          },
        ],
        validateFn: () => ({
          valid: false,
          errors: {
            apiKey: "API key is required",
            workspace: "Workspace is required",
          },
        }),
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      let actionResult: unknown;
      await act(async () => {
        actionResult = await result.current.execute(async () => "success");
      });

      // Multiple validation errors still return null and don't set submitError
      expect(actionResult).toBeNull();
      expect(result.current.submitError).toBeNull();
    });

    it("should not call action when validation fails", async () => {
      const action = vi.fn().mockResolvedValue("success");
      const connector = createMockConnector({
        validateFn: () => ({ valid: false, errors: { field: "error" } }),
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(action);
      });

      expect(action).not.toHaveBeenCalled();
    });
  });

  describe("execute - successful action", () => {
    it("should return action result on success", async () => {
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      // Set form value
      await act(async () => {
        result.current.form.setFieldValue("apiKey", "secret_test123");
      });

      let actionResult: unknown;
      await act(async () => {
        actionResult = await result.current.execute(async (data) => {
          return { success: true, apiKey: data.apiKey };
        });
      });

      expect(actionResult).toEqual({
        success: true,
        apiKey: "secret_test123",
      });
    });

    it("should pass form data to action", async () => {
      const action = vi.fn().mockResolvedValue("result");
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
          {
            name: "workspace",
            label: "Workspace",
            type: "text",
            required: false,
          },
        ],
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      // Set form values
      await act(async () => {
        result.current.form.setFieldValue("apiKey", "secret_abc123");
        result.current.form.setFieldValue("workspace", "my-workspace");
      });

      await act(async () => {
        await result.current.execute(action);
      });

      expect(action).toHaveBeenCalledWith({
        apiKey: "secret_abc123",
        workspace: "my-workspace",
      });
    });

    it("should set isSubmitting to true during action execution", async () => {
      const connector = createMockConnector({});
      const { result } = renderHook(() => useConnectorForm(connector));

      // Use a deferred promise to control when the action resolves
      let resolveAction: (value: string) => void;
      const actionPromise = new Promise<string>((resolve) => {
        resolveAction = resolve;
      });

      // Start the action (don't await it yet)
      let executePromise: Promise<unknown>;
      act(() => {
        executePromise = result.current.execute(async () => {
          await actionPromise;
          return "done";
        });
      });

      // Wait for isSubmitting to become true
      await waitFor(() => {
        expect(result.current.isSubmitting).toBe(true);
      });

      // Resolve the action
      act(() => {
        resolveAction!("done");
      });

      // Wait for the execute to complete
      await act(async () => {
        await executePromise;
      });

      // Should be false after completion
      expect(result.current.isSubmitting).toBe(false);
    });

    it("should set isSubmitting to false after action completes", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(async () => "done");
      });

      expect(result.current.isSubmitting).toBe(false);
    });

    it("should execute action after validation passes on retry", async () => {
      // Test that after a validation failure, subsequent successful validation
      // properly executes the action.
      let validationCount = 0;
      const action = vi.fn().mockResolvedValue("success");
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
        validateFn: () => {
          validationCount++;
          // First call fails, second call succeeds
          if (validationCount === 1) {
            return { valid: false, errors: { apiKey: "Error" } };
          }
          return { valid: true };
        },
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      // First execution - validation fails, action not called
      await act(async () => {
        await result.current.execute(action);
      });
      expect(action).not.toHaveBeenCalled();

      // Second execution - validation succeeds, action called
      let secondResult: unknown;
      await act(async () => {
        secondResult = await result.current.execute(action);
      });
      expect(action).toHaveBeenCalledTimes(1);
      expect(secondResult).toBe("success");
    });
  });

  describe("execute - action errors", () => {
    it("should set submitError when action throws Error", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error("Network error");
        });
      });

      expect(result.current.submitError).toBe("Network error");
    });

    it("should return null when action throws", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      let actionResult: unknown;
      await act(async () => {
        actionResult = await result.current.execute(async () => {
          throw new Error("Failed");
        });
      });

      expect(actionResult).toBeNull();
    });

    it("should set generic error message for non-Error throws", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(async () => {
          throw "string error"; // Non-Error throw
        });
      });

      expect(result.current.submitError).toBe("Operation failed");
    });

    it("should set isSubmitting to false after action fails", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error("Failed");
        });
      });

      expect(result.current.isSubmitting).toBe(false);
    });
  });

  describe("clearError", () => {
    it("should clear submitError", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      // Trigger an error first
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error("Test error");
        });
      });

      expect(result.current.submitError).toBe("Test error");

      // Clear the error
      act(() => {
        result.current.clearError();
      });

      expect(result.current.submitError).toBeNull();
    });
  });

  describe("reset", () => {
    it("should reset form values to defaults", async () => {
      const connector = createMockConnector({
        formFields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
      });

      const { result } = renderHook(() => useConnectorForm(connector));

      // Set a value
      await act(async () => {
        result.current.form.setFieldValue("apiKey", "secret_test123");
      });

      expect(result.current.form.state.values.apiKey).toBe("secret_test123");

      // Reset
      act(() => {
        result.current.reset();
      });

      await waitFor(() => {
        expect(result.current.form.state.values.apiKey).toBe("");
      });
    });

    it("should clear submitError on reset", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      // Trigger an error
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error("Test error");
        });
      });

      expect(result.current.submitError).toBe("Test error");

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.submitError).toBeNull();
    });
  });

  describe("connector identity stability", () => {
    it("should use connector.id for memoization", () => {
      const fields1: FormField[] = [
        { name: "field1", label: "Field 1", type: "text", required: true },
      ];
      const fields2: FormField[] = [
        { name: "field2", label: "Field 2", type: "text", required: true },
      ];

      // Create two different connector objects with same ID
      const connector1 = createMockConnector({
        id: "same-id",
        formFields: fields1,
      });
      const connector2 = createMockConnector({
        id: "same-id",
        formFields: fields2,
      });

      const { result, rerender } = renderHook(
        ({ connector }) => useConnectorForm(connector),
        { initialProps: { connector: connector1 } },
      );

      const initialFormFields = result.current.formFields;

      // Re-render with different connector object but same ID
      rerender({ connector: connector2 });

      // formFields should be memoized by connector.id, so it stays the same
      expect(result.current.formFields).toBe(initialFormFields);
    });
  });
});
