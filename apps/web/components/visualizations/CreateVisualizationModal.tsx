"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@dashframe/ui";
import { CreateVisualizationContent } from "./CreateVisualizationContent";

interface CreateVisualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateVisualizationModal({
  isOpen,
  onClose,
}: CreateVisualizationModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Visualization</DialogTitle>
        </DialogHeader>
        <CreateVisualizationContent onComplete={onClose} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
