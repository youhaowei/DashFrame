"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@dashframe/ui";
import {
  DataPickerContent,
  type DataPickerContentProps,
} from "./DataPickerContent";

interface DataPickerModalProps extends Omit<
  DataPickerContentProps,
  "onCancel"
> {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;
  /**
   * Called when the modal should close
   */
  onClose: () => void;
  /**
   * Modal title displayed in the header
   */
  title: string;
}

/**
 * Modal wrapper for DataPickerContent.
 *
 * Provides a dialog container with configurable title for the data picker.
 * Used for both "Create Visualization" and "Join" flows with different titles.
 *
 * @example Create Visualization
 * ```tsx
 * <DataPickerModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   title="Create Visualization"
 *   onInsightSelect={handleInsightSelect}
 *   onTableSelect={handleTableSelect}
 * />
 * ```
 *
 * @example Join Flow
 * ```tsx
 * <DataPickerModal
 *   isOpen={showJoinModal}
 *   onClose={() => setShowJoinModal(false)}
 *   title="Join with another dataset"
 *   onTableSelect={handleJoinTableSelect}
 *   excludeTableIds={[currentTableId]}
 * />
 * ```
 */
export function DataPickerModal({
  isOpen,
  onClose,
  title,
  ...pickerProps
}: DataPickerModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DataPickerContent {...pickerProps} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
