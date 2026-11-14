/**
 * Unit tests for confirm-dialog-store module
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { useConfirmDialogStore } from "./confirm-dialog-store";

describe("confirm-dialog-store", () => {
  // Reset store state before each test
  beforeEach(() => {
    useConfirmDialogStore.setState({ isOpen: false, config: null });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("confirm()", () => {
    it("should open dialog with full config", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();
      const mockOnCancel = vi.fn();

      confirm({
        title: "Delete item",
        description: "This action cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        variant: "destructive",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });

      const { isOpen, config } = useConfirmDialogStore.getState();
      expect(isOpen).toBe(true);
      expect(config).toEqual({
        title: "Delete item",
        description: "This action cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        variant: "destructive",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });
    });

    it("cancels the pending dialog before replacing its config", async () => {
      const { confirm } = useConfirmDialogStore.getState();
      let resolveFirstDialog: (result: boolean) => void;
      const firstDialog = new Promise<boolean>((resolve) => {
        resolveFirstDialog = resolve;
      });

      confirm({
        title: "First dialog",
        description: "First description",
        onConfirm: vi.fn(),
        onCancel: () => resolveFirstDialog(false),
      });
      confirm({
        title: "Second dialog",
        description: "Second description",
        onConfirm: vi.fn(),
      });

      await expect(firstDialog).resolves.toBe(false);
      expect(useConfirmDialogStore.getState().config?.title).toBe(
        "Second dialog",
      );
      expect(useConfirmDialogStore.getState().isOpen).toBe(true);
    });
  });

  describe("close()", () => {
    it("should close dialog", () => {
      const { confirm, close } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
      });

      expect(useConfirmDialogStore.getState().isOpen).toBe(true);

      close();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });
  });

  describe("handleConfirm()", () => {
    it("should call onConfirm callback", () => {
      const { confirm, handleConfirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
      });

      handleConfirm();

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("should handle confirming when config is null", () => {
      const { handleConfirm } = useConfirmDialogStore.getState();

      // Should not throw
      expect(() => handleConfirm()).not.toThrow();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("catches rejected async callbacks", async () => {
      const { confirm, handleConfirm } = useConfirmDialogStore.getState();
      const error = new Error("delete failed");
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: vi.fn().mockRejectedValue(error),
      });

      await handleConfirm();

      expect(consoleError).toHaveBeenCalledWith(
        "Confirm dialog action failed:",
        error,
      );
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      consoleError.mockRestore();
    });
  });

  describe("handleCancel()", () => {
    it("should call onCancel callback when provided", () => {
      const { confirm, handleCancel } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();
      const mockOnCancel = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });

      handleCancel();

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
      expect(mockOnConfirm).not.toHaveBeenCalled();
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("should not throw when onCancel is not provided", () => {
      const { confirm, handleCancel } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
      });

      // Should not throw
      expect(() => handleCancel()).not.toThrow();

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it("should handle cancelling when config is null", () => {
      const { handleCancel } = useConfirmDialogStore.getState();

      // Should not throw
      expect(() => handleCancel()).not.toThrow();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });
  });

  describe("integration scenarios", () => {
    it("should support close without action", () => {
      const { confirm, close } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();
      const mockOnCancel = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });

      // User closes dialog via escape key or backdrop click
      close();

      expect(mockOnConfirm).not.toHaveBeenCalled();
      expect(mockOnCancel).not.toHaveBeenCalled();
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    });
  });
});
