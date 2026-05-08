"use client";

import { toast as sonnerToast } from "sonner";
import { create } from "zustand";

/**
 * Toast notification types
 */
export type ToastType = "success" | "error" | "warning" | "info";

/**
 * Optional action button for toast notifications
 */
export interface ToastAction {
  /** Label for the action button */
  label: string;
  /** Callback when action is clicked */
  onClick: () => void;
}

/**
 * Configuration for a toast notification
 */
export interface ToastConfig {
  /** Unique identifier for the toast */
  id: string;
  /** Type of toast notification */
  type: ToastType;
  /** Main message to display */
  message: string;
  /** Optional description/subtitle */
  description?: string;
  /** Duration in milliseconds before auto-dismiss (default: 4000) */
  duration?: number;
  /** Optional action button */
  action?: ToastAction;
}

/**
 * Input config for showing a toast (id is auto-generated)
 */
export type ShowToastConfig = Omit<ToastConfig, "id" | "type"> & {
  type?: ToastType;
};

interface ToastState {
  /** Array of currently displayed toasts */
  toasts: ToastConfig[];
}

interface ToastActions {
  /** Show a toast notification */
  show: (config: ShowToastConfig) => string;
  /** Show a success toast */
  showSuccess: (
    message: string,
    options?: Omit<ShowToastConfig, "message" | "type">,
  ) => string;
  /** Show an error toast */
  showError: (
    message: string,
    options?: Omit<ShowToastConfig, "message" | "type">,
  ) => string;
  /** Show a warning toast */
  showWarning: (
    message: string,
    options?: Omit<ShowToastConfig, "message" | "type">,
  ) => string;
  /** Show an info toast */
  showInfo: (
    message: string,
    options?: Omit<ShowToastConfig, "message" | "type">,
  ) => string;
  /** Dismiss a specific toast by ID */
  dismiss: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

/** Default duration for auto-dismiss in milliseconds */
const DEFAULT_DURATION = 4000;

/** Counter for generating unique toast IDs */
let toastCounter = 0;

/** Generate a unique ID for each toast */
const generateId = () => `toast-${Date.now()}-${++toastCounter}`;

/** Create a callback to remove a toast from store state by ID */
const createRemoveCallback = (
  set: (fn: (state: ToastState) => Partial<ToastState>) => void,
  id: string,
) => {
  return () => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  };
};

/**
 * Global toast notification store
 *
 * Provides a centralized way to show toast notifications throughout the app.
 * Wraps Sonner's toast functionality with a Zustand store for consistent API
 * and easier testing.
 *
 * @example
 * ```tsx
 * const { showSuccess, showError } = useToastStore();
 *
 * const handleSave = async () => {
 *   try {
 *     await saveData();
 *     showSuccess("Data saved successfully");
 *   } catch (error) {
 *     showError("Failed to save data");
 *   }
 * };
 *
 * // With action button
 * showError("Failed to upload", {
 *   description: "Network error occurred",
 *   action: {
 *     label: "Retry",
 *     onClick: () => retryUpload(),
 *   },
 * });
 * ```
 */
export const useToastStore = create<ToastState & ToastActions>()(
  (set, get) => ({
    toasts: [],

    show: (config) => {
      const id = generateId();
      const type = config.type ?? "info";
      const duration = config.duration ?? DEFAULT_DURATION;

      const toastConfig: ToastConfig = {
        id,
        type,
        message: config.message,
        description: config.description,
        duration,
        action: config.action,
      };

      // Add to store state
      set((state) => ({
        toasts: [...state.toasts, toastConfig],
      }));

      // Create callback to clean up store state when toast is dismissed
      const removeFromStore = createRemoveCallback(set, id);

      // Call Sonner toast with appropriate type
      const sonnerOptions = {
        id,
        description: config.description,
        duration,
        action: config.action
          ? {
              label: config.action.label,
              onClick: config.action.onClick,
            }
          : undefined,
        // Clean up store state when toast is dismissed (manual or auto)
        onDismiss: removeFromStore,
        onAutoClose: removeFromStore,
      };

      switch (type) {
        case "success":
          sonnerToast.success(config.message, sonnerOptions);
          break;
        case "error":
          sonnerToast.error(config.message, sonnerOptions);
          break;
        case "warning":
          sonnerToast.warning(config.message, sonnerOptions);
          break;
        case "info":
          sonnerToast.info(config.message, sonnerOptions);
          break;
      }

      return id;
    },

    showSuccess: (message, options) => {
      return get().show({ ...options, message, type: "success" });
    },

    showError: (message, options) => {
      return get().show({ ...options, message, type: "error" });
    },

    showWarning: (message, options) => {
      return get().show({ ...options, message, type: "warning" });
    },

    showInfo: (message, options) => {
      return get().show({ ...options, message, type: "info" });
    },

    dismiss: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
      sonnerToast.dismiss(id);
    },

    dismissAll: () => {
      set({ toasts: [] });
      sonnerToast.dismiss();
    },
  }),
);
