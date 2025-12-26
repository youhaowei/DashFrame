"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from "@dashframe/ui";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";

/**
 * Global confirm dialog component
 *
 * Renders a confirmation dialog controlled by the global confirm dialog store.
 * Should be rendered once at the root layout level.
 *
 * @example
 * ```tsx
 * // In your root layout
 * <ConfirmDialog />
 * ```
 */
export function ConfirmDialog() {
  const { isOpen, config, handleConfirm, handleCancel } =
    useConfirmDialogStore();

  if (!config) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            label={config.cancelLabel || "Cancel"}
            variant="outlined"
            onClick={handleCancel}
          />
          <Button
            label={config.confirmLabel || "Confirm"}
            color={config.variant === "destructive" ? "danger" : undefined}
            onClick={handleConfirm}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
