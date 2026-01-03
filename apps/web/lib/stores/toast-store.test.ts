/**
 * Unit tests for toast-store module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "./toast-store";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// Import mocked toast after mock setup
import { toast as sonnerToast } from "sonner";

describe("toast-store", () => {
  // Reset store state before each test
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("show()", () => {
    it("should add toast to store state", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test message" });

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe("Test message");
    });

    it("should call sonner toast with correct type", () => {
      const { show } = useToastStore.getState();

      show({ message: "Success message", type: "success" });
      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Success message",
        expect.any(Object),
      );

      show({ message: "Error message", type: "error" });
      expect(sonnerToast.error).toHaveBeenCalledWith(
        "Error message",
        expect.any(Object),
      );

      show({ message: "Warning message", type: "warning" });
      expect(sonnerToast.warning).toHaveBeenCalledWith(
        "Warning message",
        expect.any(Object),
      );

      show({ message: "Info message", type: "info" });
      expect(sonnerToast.info).toHaveBeenCalledWith(
        "Info message",
        expect.any(Object),
      );
    });

    it("should default to info type when type is not specified", () => {
      const { show } = useToastStore.getState();

      show({ message: "Default type message" });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].type).toBe("info");
      expect(sonnerToast.info).toHaveBeenCalled();
    });

    it("should return the generated toast ID", () => {
      const { show } = useToastStore.getState();

      const id = show({ message: "Test message" });

      expect(typeof id).toBe("string");
      expect(id).toMatch(/^toast-\d+-\d+$/);
    });

    it("should include description in toast config", () => {
      const { show } = useToastStore.getState();

      show({ message: "Main message", description: "Additional details" });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].description).toBe("Additional details");
    });
  });

  describe("showSuccess()", () => {
    it("should add success toast to store", () => {
      const { showSuccess } = useToastStore.getState();

      showSuccess("Operation completed");

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("success");
      expect(toasts[0].message).toBe("Operation completed");
    });

    it("should call sonner success toast", () => {
      const { showSuccess } = useToastStore.getState();

      showSuccess("Operation completed");

      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Operation completed",
        expect.any(Object),
      );
    });

    it("should accept optional configuration", () => {
      const { showSuccess } = useToastStore.getState();

      showSuccess("Success!", { description: "Details here", duration: 5000 });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].description).toBe("Details here");
      expect(toasts[0].duration).toBe(5000);
    });
  });

  describe("showError()", () => {
    it("should add error toast to store", () => {
      const { showError } = useToastStore.getState();

      showError("Something went wrong");

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
      expect(toasts[0].message).toBe("Something went wrong");
    });

    it("should call sonner error toast", () => {
      const { showError } = useToastStore.getState();

      showError("Something went wrong");

      expect(sonnerToast.error).toHaveBeenCalledWith(
        "Something went wrong",
        expect.any(Object),
      );
    });
  });

  describe("showWarning()", () => {
    it("should add warning toast to store", () => {
      const { showWarning } = useToastStore.getState();

      showWarning("Please be careful");

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("warning");
      expect(toasts[0].message).toBe("Please be careful");
    });

    it("should call sonner warning toast", () => {
      const { showWarning } = useToastStore.getState();

      showWarning("Please be careful");

      expect(sonnerToast.warning).toHaveBeenCalledWith(
        "Please be careful",
        expect.any(Object),
      );
    });
  });

  describe("showInfo()", () => {
    it("should add info toast to store", () => {
      const { showInfo } = useToastStore.getState();

      showInfo("Here is some information");

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("info");
      expect(toasts[0].message).toBe("Here is some information");
    });

    it("should call sonner info toast", () => {
      const { showInfo } = useToastStore.getState();

      showInfo("Here is some information");

      expect(sonnerToast.info).toHaveBeenCalledWith(
        "Here is some information",
        expect.any(Object),
      );
    });
  });

  describe("dismiss()", () => {
    it("should remove specific toast from store", () => {
      const { show, dismiss } = useToastStore.getState();

      const id1 = show({ message: "First toast" });
      const id2 = show({ message: "Second toast" });
      show({ message: "Third toast" });

      dismiss(id2);

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(2);
      expect(toasts.find((t) => t.id === id2)).toBeUndefined();
      expect(toasts.find((t) => t.id === id1)).toBeDefined();
    });

    it("should call sonner dismiss with toast ID", () => {
      const { show, dismiss } = useToastStore.getState();

      const id = show({ message: "Test toast" });
      dismiss(id);

      expect(sonnerToast.dismiss).toHaveBeenCalledWith(id);
    });

    it("should handle dismissing non-existent ID gracefully", () => {
      const { show, dismiss } = useToastStore.getState();

      show({ message: "Test toast" });

      // Should not throw
      expect(() => dismiss("non-existent-id")).not.toThrow();

      const { toasts } = useToastStore.getState();
      expect(toasts).toHaveLength(1);
    });
  });

  describe("dismissAll()", () => {
    it("should clear all toasts from store", () => {
      const { show, dismissAll } = useToastStore.getState();

      show({ message: "First toast" });
      show({ message: "Second toast" });
      show({ message: "Third toast" });

      expect(useToastStore.getState().toasts).toHaveLength(3);

      dismissAll();

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it("should call sonner dismiss without arguments", () => {
      const { show, dismissAll } = useToastStore.getState();

      show({ message: "Test toast" });
      dismissAll();

      expect(sonnerToast.dismiss).toHaveBeenCalledWith();
    });

    it("should handle dismissAll on empty store", () => {
      const { dismissAll } = useToastStore.getState();

      // Should not throw
      expect(() => dismissAll()).not.toThrow();
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe("action callbacks", () => {
    it("should store action in toast config", () => {
      const { show } = useToastStore.getState();
      const mockCallback = vi.fn();

      show({
        message: "Action toast",
        action: {
          label: "Retry",
          onClick: mockCallback,
        },
      });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].action).toBeDefined();
      expect(toasts[0].action?.label).toBe("Retry");
    });

    it("should have invokable action callback", () => {
      const { show } = useToastStore.getState();
      const mockCallback = vi.fn();

      show({
        message: "Action toast",
        action: {
          label: "Retry",
          onClick: mockCallback,
        },
      });

      const { toasts } = useToastStore.getState();
      toasts[0].action?.onClick();

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it("should pass action to sonner toast", () => {
      const { show } = useToastStore.getState();
      const mockCallback = vi.fn();

      show({
        message: "Action toast",
        type: "error",
        action: {
          label: "Retry",
          onClick: mockCallback,
        },
      });

      expect(sonnerToast.error).toHaveBeenCalledWith(
        "Action toast",
        expect.objectContaining({
          action: {
            label: "Retry",
            onClick: mockCallback,
          },
        }),
      );
    });
  });

  describe("auto-generated IDs", () => {
    it("should generate unique IDs for each toast", () => {
      const { show } = useToastStore.getState();

      const id1 = show({ message: "First toast" });
      const id2 = show({ message: "Second toast" });
      const id3 = show({ message: "Third toast" });

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("should generate IDs with expected format", () => {
      const { show } = useToastStore.getState();

      const id = show({ message: "Test toast" });

      // Format: toast-{timestamp}-{counter}
      expect(id).toMatch(/^toast-\d+-\d+$/);
    });

    it("should store generated ID in toast config", () => {
      const { show } = useToastStore.getState();

      const id = show({ message: "Test toast" });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].id).toBe(id);
    });

    it("should pass generated ID to sonner", () => {
      const { show } = useToastStore.getState();

      const id = show({ message: "Test toast", type: "success" });

      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Test toast",
        expect.objectContaining({ id }),
      );
    });
  });

  describe("default duration", () => {
    it("should apply default duration of 4000ms", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test toast" });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].duration).toBe(4000);
    });

    it("should pass default duration to sonner", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test toast", type: "info" });

      expect(sonnerToast.info).toHaveBeenCalledWith(
        "Test toast",
        expect.objectContaining({ duration: 4000 }),
      );
    });
  });

  describe("custom duration override", () => {
    it("should allow custom duration", () => {
      const { show } = useToastStore.getState();

      show({ message: "Long toast", duration: 10000 });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].duration).toBe(10000);
    });

    it("should pass custom duration to sonner", () => {
      const { show } = useToastStore.getState();

      show({ message: "Long toast", type: "success", duration: 10000 });

      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Long toast",
        expect.objectContaining({ duration: 10000 }),
      );
    });

    it("should allow zero duration for permanent toasts", () => {
      const { show } = useToastStore.getState();

      show({ message: "Permanent toast", duration: 0 });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].duration).toBe(0);
    });

    it("should allow custom duration via helper methods", () => {
      const { showSuccess, showError } = useToastStore.getState();

      showSuccess("Quick success", { duration: 2000 });
      showError("Persistent error", { duration: 8000 });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].duration).toBe(2000);
      expect(toasts[1].duration).toBe(8000);
    });
  });

  describe("auto-dismiss cleanup", () => {
    it("should pass onAutoClose callback to sonner", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test toast", type: "success" });

      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Test toast",
        expect.objectContaining({
          onAutoClose: expect.any(Function),
        }),
      );
    });

    it("should pass onDismiss callback to sonner", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test toast", type: "info" });

      expect(sonnerToast.info).toHaveBeenCalledWith(
        "Test toast",
        expect.objectContaining({
          onDismiss: expect.any(Function),
        }),
      );
    });

    it("should remove toast from store when onAutoClose is called", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test toast", type: "success" });

      // Get the onAutoClose callback that was passed to sonner
      const sonnerCall = vi.mocked(sonnerToast.success).mock.calls[0];
      const options = sonnerCall[1] as { onAutoClose: () => void };

      expect(useToastStore.getState().toasts).toHaveLength(1);

      // Simulate Sonner calling onAutoClose
      options.onAutoClose();

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it("should remove toast from store when onDismiss is called", () => {
      const { show } = useToastStore.getState();

      show({ message: "Test toast", type: "error" });

      // Get the onDismiss callback that was passed to sonner
      const sonnerCall = vi.mocked(sonnerToast.error).mock.calls[0];
      const options = sonnerCall[1] as { onDismiss: () => void };

      expect(useToastStore.getState().toasts).toHaveLength(1);

      // Simulate Sonner calling onDismiss (manual dismiss via close button or swipe)
      options.onDismiss();

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it("should only remove the specific toast when callback is called", () => {
      const { show } = useToastStore.getState();

      show({ message: "First toast", type: "success" });
      show({ message: "Second toast", type: "info" });

      // Get the onAutoClose callback for the first toast
      const firstSonnerCall = vi.mocked(sonnerToast.success).mock.calls[0];
      const firstOptions = firstSonnerCall[1] as { onAutoClose: () => void };

      expect(useToastStore.getState().toasts).toHaveLength(2);

      // Simulate first toast auto-closing
      firstOptions.onAutoClose();

      const remainingToasts = useToastStore.getState().toasts;
      expect(remainingToasts).toHaveLength(1);
      expect(remainingToasts[0].message).toBe("Second toast");
    });
  });
});
