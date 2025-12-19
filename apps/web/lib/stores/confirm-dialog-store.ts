"use client";

import { create } from "zustand";

/**
 * Configuration for the confirm dialog
 */
export interface ConfirmDialogConfig {
  /** Dialog title */
  title: string;
  /** Dialog description/message */
  description: string;
  /** Label for the confirm button */
  confirmLabel?: string;
  /** Label for the cancel button */
  cancelLabel?: string;
  /** Variant for the confirm button */
  variant?: "default" | "destructive";
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Callback when cancelled (optional) */
  onCancel?: () => void;
}

interface ConfirmDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current dialog configuration */
  config: ConfirmDialogConfig | null;
}

interface ConfirmDialogActions {
  /** Open the confirm dialog with the given configuration */
  confirm: (config: ConfirmDialogConfig) => void;
  /** Close the dialog (called by the dialog component) */
  close: () => void;
  /** Handle the confirm action */
  handleConfirm: () => void;
  /** Handle the cancel action */
  handleCancel: () => void;
}

/**
 * Global confirm dialog store
 *
 * Provides a centralized way to show confirmation dialogs throughout the app.
 * The dialog UI is rendered once in the root layout and controlled via this store.
 *
 * @example
 * ```tsx
 * const { confirm } = useConfirmDialogStore();
 *
 * const handleDelete = () => {
 *   confirm({
 *     title: "Delete item",
 *     description: "Are you sure you want to delete this item? This action cannot be undone.",
 *     confirmLabel: "Delete",
 *     variant: "destructive",
 *     onConfirm: () => deleteItem(itemId),
 *   });
 * };
 * ```
 */
export const useConfirmDialogStore = create<
  ConfirmDialogState & ConfirmDialogActions
>()((set, get) => ({
  isOpen: false,
  config: null,

  confirm: (config) => {
    set({ isOpen: true, config });
  },

  close: () => {
    set({ isOpen: false, config: null });
  },

  handleConfirm: () => {
    const { config } = get();
    if (config?.onConfirm) {
      config.onConfirm();
    }
    set({ isOpen: false, config: null });
  },

  handleCancel: () => {
    const { config } = get();
    if (config?.onCancel) {
      config.onCancel();
    }
    set({ isOpen: false, config: null });
  },
}));
