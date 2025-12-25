"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  PrimitiveButton,
} from "@dashframe/ui";
import { DataPickerModal } from "@/components/data-sources/DataPickerModal";
import { useCreateInsight } from "@/hooks/useCreateInsight";

interface CreateVisualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for creating a new visualization.
 *
 * Uses DataPickerModal for unified data selection, with an action dialog
 * that appears when selecting an existing insight (asking whether to
 * edit or create a new derived insight).
 */
export function CreateVisualizationModal({
  isOpen,
  onClose,
}: CreateVisualizationModalProps) {
  const router = useRouter();
  const { createInsightFromTable, createInsightFromInsight } =
    useCreateInsight();

  // State for the "what do you want to do?" dialog
  const [selectedInsight, setSelectedInsight] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // When selecting an existing insight, show action dialog
  const handleInsightSelect = useCallback(
    (insightId: string, insightName: string) => {
      setSelectedInsight({ id: insightId, name: insightName });
    },
    [],
  );

  // User chose to edit the existing insight
  const handleEditInsight = useCallback(() => {
    if (!selectedInsight) return;
    router.push(`/insights/${selectedInsight.id}`);
    setSelectedInsight(null);
    onClose();
  }, [selectedInsight, router, onClose]);

  // User chose to create a new insight based on this one
  const handleCreateBasedOn = useCallback(() => {
    if (!selectedInsight) return;
    // Create new insight that chains from the selected insight's DataFrame
    createInsightFromInsight(selectedInsight.id, selectedInsight.name);
    setSelectedInsight(null);
    onClose();
  }, [selectedInsight, createInsightFromInsight, onClose]);

  // When selecting a table, create new insight directly
  const handleTableSelect = useCallback(
    (tableId: string, tableName: string) => {
      createInsightFromTable(tableId, tableName);
      onClose();
    },
    [createInsightFromTable, onClose],
  );

  // Close action dialog
  const handleCloseActionDialog = useCallback(() => {
    setSelectedInsight(null);
  }, []);

  return (
    <>
      <DataPickerModal
        isOpen={isOpen && !selectedInsight}
        onClose={onClose}
        title="Create Visualization"
        onInsightSelect={handleInsightSelect}
        onTableSelect={handleTableSelect}
        showInsights={true}
      />

      {/* Action Dialog: What do you want to do with this insight? */}
      <Dialog open={!!selectedInsight} onOpenChange={handleCloseActionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>What would you like to do?</DialogTitle>
            <DialogDescription>
              You selected &ldquo;{selectedInsight?.name}&rdquo;
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-4">
            <PrimitiveButton
              onClick={handleEditInsight}
              variant="outlined"
              className="h-auto flex-col items-start gap-1 py-3"
            >
              <span className="font-medium">Edit this insight</span>
              <span className="text-muted-foreground text-xs font-normal">
                Open and modify the existing insight
              </span>
            </PrimitiveButton>
            <PrimitiveButton
              onClick={handleCreateBasedOn}
              className="h-auto flex-col items-start gap-1 py-3"
            >
              <span className="font-medium">Create new based on this</span>
              <span className="text-muted-foreground text-xs font-normal">
                Chain a new insight from this data
              </span>
            </PrimitiveButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
