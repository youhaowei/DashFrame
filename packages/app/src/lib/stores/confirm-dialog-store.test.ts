/**
 * Unit tests for confirm-dialog-store module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConfirmDialogStore,
  type ConfirmDialogConfig,
} from "./confirm-dialog-store";

describe("confirm-dialog-store", () => {
  // Reset store state before each test
  beforeEach(() => {
    useConfirmDialogStore.setState({ isOpen: false, config: null });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should have dialog closed by default", () => {
      const { isOpen } = useConfirmDialogStore.getState();
      expect(isOpen).toBe(false);
    });

    it("should have null config by default", () => {
      const { config } = useConfirmDialogStore.getState();
      expect(config).toBeNull();
    });
  });

  describe("confirm()", () => {
    it("should open dialog with basic config", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Delete item",
        description: "Are you sure?",
        onConfirm: mockOnConfirm,
      });

      const { isOpen, config } = useConfirmDialogStore.getState();
      expect(isOpen).toBe(true);
      expect(config).toEqual({
        title: "Delete item",
        description: "Are you sure?",
        onConfirm: mockOnConfirm,
      });
    });

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

    it("should support default variant", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Save changes",
        description: "Do you want to save your changes?",
        variant: "default",
        onConfirm: mockOnConfirm,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.variant).toBe("default");
    });

    it("should support destructive variant", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Delete permanently",
        description: "This will delete everything.",
        variant: "destructive",
        onConfirm: mockOnConfirm,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.variant).toBe("destructive");
    });

    it("should replace previous config when called multiple times", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm1 = vi.fn();
      const mockOnConfirm2 = vi.fn();

      confirm({
        title: "First dialog",
        description: "First description",
        onConfirm: mockOnConfirm1,
      });

      confirm({
        title: "Second dialog",
        description: "Second description",
        onConfirm: mockOnConfirm2,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.title).toBe("Second dialog");
      expect(config?.description).toBe("Second description");
      expect(config?.onConfirm).toBe(mockOnConfirm2);
    });

    it("should keep dialog open when replacing config", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm1 = vi.fn();
      const mockOnConfirm2 = vi.fn();

      confirm({
        title: "First dialog",
        description: "First description",
        onConfirm: mockOnConfirm1,
      });

      expect(useConfirmDialogStore.getState().isOpen).toBe(true);

      confirm({
        title: "Second dialog",
        description: "Second description",
        onConfirm: mockOnConfirm2,
      });

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
    });

    it("should clear config when closing", () => {
      const { confirm, close } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
      });

      expect(useConfirmDialogStore.getState().config).not.toBeNull();

      close();

      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("should handle closing when already closed", () => {
      const { close } = useConfirmDialogStore.getState();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);

      // Should not throw
      expect(() => close()).not.toThrow();

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
    });

    it("should close dialog after confirming", () => {
      const { confirm, handleConfirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
      });

      expect(useConfirmDialogStore.getState().isOpen).toBe(true);

      handleConfirm();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    });

    it("should clear config after confirming", () => {
      const { confirm, handleConfirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
      });

      expect(useConfirmDialogStore.getState().config).not.toBeNull();

      handleConfirm();

      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("should handle confirming when config is null", () => {
      const { handleConfirm } = useConfirmDialogStore.getState();

      // Should not throw
      expect(() => handleConfirm()).not.toThrow();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("should handle confirming when onConfirm is undefined", () => {
      const { handleConfirm } = useConfirmDialogStore.getState();

      // Manually set config without onConfirm (edge case)
      useConfirmDialogStore.setState({
        isOpen: true,
        config: {
          title: "Test",
          description: "Test",
          onConfirm: undefined as unknown as () => void, // Simulate missing callback
        },
      });

      // Should not throw
      expect(() => handleConfirm()).not.toThrow();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
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

    it("should close dialog after cancelling", () => {
      const { confirm, handleCancel } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();
      const mockOnCancel = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });

      expect(useConfirmDialogStore.getState().isOpen).toBe(true);

      handleCancel();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    });

    it("should clear config after cancelling", () => {
      const { confirm, handleCancel } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();
      const mockOnCancel = vi.fn();

      confirm({
        title: "Test dialog",
        description: "Test description",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });

      expect(useConfirmDialogStore.getState().config).not.toBeNull();

      handleCancel();

      expect(useConfirmDialogStore.getState().config).toBeNull();
    });

    it("should handle cancelling when config is null", () => {
      const { handleCancel } = useConfirmDialogStore.getState();

      // Should not throw
      expect(() => handleCancel()).not.toThrow();

      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
      expect(useConfirmDialogStore.getState().config).toBeNull();
    });
  });

  describe("button labels", () => {
    it("should support custom confirm label", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Delete item",
        description: "Are you sure?",
        confirmLabel: "Yes, delete it",
        onConfirm: mockOnConfirm,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.confirmLabel).toBe("Yes, delete it");
    });

    it("should support custom cancel label", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Delete item",
        description: "Are you sure?",
        cancelLabel: "No, keep it",
        onConfirm: mockOnConfirm,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.cancelLabel).toBe("No, keep it");
    });

    it("should support both custom labels", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Delete item",
        description: "Are you sure?",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        onConfirm: mockOnConfirm,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.confirmLabel).toBe("Delete");
      expect(config?.cancelLabel).toBe("Cancel");
    });

    it("should allow undefined labels", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();

      confirm({
        title: "Delete item",
        description: "Are you sure?",
        onConfirm: mockOnConfirm,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.confirmLabel).toBeUndefined();
      expect(config?.cancelLabel).toBeUndefined();
    });
  });

  describe("integration scenarios", () => {
    it("should support delete confirmation workflow", () => {
      const { confirm, handleConfirm } = useConfirmDialogStore.getState();
      const deleteItem = vi.fn();

      // User clicks delete button
      confirm({
        title: "Delete item",
        description:
          "Are you sure you want to delete this item? This action cannot be undone.",
        confirmLabel: "Delete",
        variant: "destructive",
        onConfirm: () => deleteItem("item-123"),
      });

      expect(useConfirmDialogStore.getState().isOpen).toBe(true);

      // User clicks confirm
      handleConfirm();

      expect(deleteItem).toHaveBeenCalledWith("item-123");
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    });

    it("should support save changes workflow with cancel", () => {
      const { confirm, handleCancel } = useConfirmDialogStore.getState();
      const saveChanges = vi.fn();
      const discardChanges = vi.fn();

      // User tries to navigate away with unsaved changes
      confirm({
        title: "Unsaved changes",
        description: "You have unsaved changes. Do you want to save them?",
        confirmLabel: "Save",
        cancelLabel: "Discard",
        variant: "default",
        onConfirm: saveChanges,
        onCancel: discardChanges,
      });

      expect(useConfirmDialogStore.getState().isOpen).toBe(true);

      // User clicks discard
      handleCancel();

      expect(saveChanges).not.toHaveBeenCalled();
      expect(discardChanges).toHaveBeenCalledTimes(1);
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    });

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

    it("should support rapid confirm/cancel cycles", () => {
      const { confirm, handleConfirm, handleCancel } =
        useConfirmDialogStore.getState();
      const action1 = vi.fn();
      const action2 = vi.fn();
      const cancel2 = vi.fn();

      // First dialog - confirm
      confirm({
        title: "First dialog",
        description: "First action",
        onConfirm: action1,
      });
      handleConfirm();

      expect(action1).toHaveBeenCalledTimes(1);
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);

      // Second dialog - cancel
      confirm({
        title: "Second dialog",
        description: "Second action",
        onConfirm: action2,
        onCancel: cancel2,
      });
      handleCancel();

      expect(action2).not.toHaveBeenCalled();
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    });
  });

  describe("type safety", () => {
    it("should enforce required fields in config", () => {
      const { confirm } = useConfirmDialogStore.getState();

      // TypeScript should require title, description, and onConfirm
      const validConfig: ConfirmDialogConfig = {
        title: "Test",
        description: "Test description",
        onConfirm: () => {},
      };

      expect(() => confirm(validConfig)).not.toThrow();
    });

    it("should allow optional fields in config", () => {
      const { confirm } = useConfirmDialogStore.getState();

      const configWithOptionals: ConfirmDialogConfig = {
        title: "Test",
        description: "Test description",
        confirmLabel: "OK",
        cancelLabel: "Cancel",
        variant: "destructive",
        onConfirm: () => {},
        onCancel: () => {},
      };

      expect(() => confirm(configWithOptionals)).not.toThrow();
    });

    it("should preserve callback references", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm = vi.fn();
      const mockOnCancel = vi.fn();

      confirm({
        title: "Test",
        description: "Test",
        onConfirm: mockOnConfirm,
        onCancel: mockOnCancel,
      });

      const { config } = useConfirmDialogStore.getState();
      expect(config?.onConfirm).toBe(mockOnConfirm);
      expect(config?.onCancel).toBe(mockOnCancel);
    });
  });

  describe("state immutability", () => {
    it("should not mutate previous state when confirming", () => {
      const { confirm } = useConfirmDialogStore.getState();
      const mockOnConfirm1 = vi.fn();

      confirm({
        title: "First",
        description: "First",
        onConfirm: mockOnConfirm1,
      });

      const firstConfig = useConfirmDialogStore.getState().config;

      const mockOnConfirm2 = vi.fn();
      confirm({
        title: "Second",
        description: "Second",
        onConfirm: mockOnConfirm2,
      });

      // First config should still reference the original callback
      expect(firstConfig?.onConfirm).toBe(mockOnConfirm1);
      expect(firstConfig?.title).toBe("First");
    });
  });
});
