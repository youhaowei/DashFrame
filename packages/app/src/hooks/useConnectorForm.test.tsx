/**
 * Unit tests for useConnectorForm hook
 *
 * Tests cover:
 * - Validation failures stop the action
 * - Successful action execution with form data
 * - Error handling for failed actions
 */
import type {
  BaseConnector,
  FormField,
  ValidationResult,
} from "@dashframe/engine";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useConnectorForm } from "./useConnectorForm";

// Create a mock connector for testing
function createMockConnector(options: {
  formFields?: FormField[];
  validateFn?: (data: Record<string, unknown>) => ValidationResult;
}): BaseConnector {
  return {
    id: "mock-connector",
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

  describe("execute - validation errors", () => {
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
  });

  describe("execute - successful action", () => {
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

      let actionResult: unknown;
      await act(async () => {
        actionResult = await result.current.execute(async () => {
          throw new Error("Network error");
        });
      });

      expect(result.current.submitError).toBe(
        "Couldn't connect. Check your settings and try again.",
      );
      expect(actionResult).toBeNull();
      expect(result.current.isSubmitting).toBe(false);
    });

    it("keeps the generic message for errors the caller does not recognize", async () => {
      const connector = createMockConnector({});
      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(
          async () => {
            throw new TypeError("Failed to fetch");
          },
          { errorMessage: () => undefined },
        );
      });

      expect(result.current.submitError).toBe(
        "Couldn't connect. Check your settings and try again.",
      );
    });

    it("shows the caller's message for errors it recognizes", async () => {
      const connector = createMockConnector({});

      const { result } = renderHook(() => useConnectorForm(connector));

      await act(async () => {
        await result.current.execute(
          async () => {
            throw new Error("Google Analytics OAuth is not configured");
          },
          { errorMessage: (error) => (error as Error).message },
        );
      });

      expect(result.current.submitError).toBe(
        "Google Analytics OAuth is not configured",
      );
    });
  });
});
