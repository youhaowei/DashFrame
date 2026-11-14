/**
 * Unit tests for toast-store module
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { useToastStore } from "./toast-store";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
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
  });

  describe("showSuccess()", () => {
    it("should call sonner success toast", () => {
      const { showSuccess } = useToastStore.getState();

      showSuccess("Operation completed");

      expect(sonnerToast.success).toHaveBeenCalledWith(
        "Operation completed",
        expect.any(Object),
      );
    });
  });

  describe("showError()", () => {
    it("should call sonner error toast", () => {
      const { showError } = useToastStore.getState();

      showError("Something went wrong");

      expect(sonnerToast.error).toHaveBeenCalledWith(
        "Something went wrong",
        expect.any(Object),
      );
    });
  });

  describe("action callbacks", () => {
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
  });

  describe("custom duration override", () => {
    it("should allow zero duration for permanent toasts", () => {
      const { show } = useToastStore.getState();

      show({ message: "Permanent toast", duration: 0 });

      const { toasts } = useToastStore.getState();
      expect(toasts[0].duration).toBe(0);
    });
  });

  describe("auto-dismiss cleanup", () => {
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
