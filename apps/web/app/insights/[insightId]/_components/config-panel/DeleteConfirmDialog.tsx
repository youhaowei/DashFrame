"use client";

import type { Visualization, VisualizationEncoding } from "@dashframe/types";
import { fieldEncoding, metricEncoding } from "@dashframe/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@dashframe/ui";
import { AlertCircleIcon, CloseIcon, DeleteIcon } from "@dashframe/ui/icons";

/** Information about a visualization that uses the item being deleted */
export interface AffectedVisualization {
  visualization: Visualization;
  /** Which encoding channels use this item (x, y, color, size) */
  affectedChannels: (keyof VisualizationEncoding)[];
}

/** Type of item being deleted */
export type DeleteItemType = "field" | "metric";

interface DeleteConfirmDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Item name for display */
  itemName: string;
  /** Type of item being deleted */
  itemType: DeleteItemType;
  /** Visualizations that use this item (computed reactively by parent) */
  affectedVisualizations: AffectedVisualization[];
  /** ID of visualization currently being processed (managed by parent) */
  processingVizId: string | null;
  /** Called when dialog is closed */
  onClose: () => void;
  /** Called to remove the item from a visualization's encoding */
  onRemoveFromVisualization: (vizId: string) => Promise<void>;
  /** Called to delete a visualization entirely */
  onDeleteVisualization: (vizId: string) => Promise<void>;
  /** Called to delete the item after all dependencies are resolved */
  onDelete: () => void;
}

/**
 * DeleteConfirmDialog - Confirmation dialog for deleting fields/metrics
 *
 * If the item is used by visualizations, shows affected visualizations
 * with options to either remove from encoding or delete the visualization.
 * Once all dependencies are resolved, allows the actual deletion.
 */
export function DeleteConfirmDialog({
  isOpen,
  itemName,
  itemType,
  affectedVisualizations,
  processingVizId,
  onClose,
  onRemoveFromVisualization,
  onDeleteVisualization,
  onDelete,
}: DeleteConfirmDialogProps) {
  const hasAffectedVisualizations = affectedVisualizations.length > 0;
  const affectedCount = affectedVisualizations.length;
  const visualizationWord =
    affectedCount === 1 ? "visualization" : "visualizations";

  const handleDelete = () => {
    onDelete();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircleIcon className="h-5 w-5 text-amber-500" />
            Delete {itemType}
          </DialogTitle>
          <DialogDescription>
            {hasAffectedVisualizations
              ? `"${itemName}" is used by ${affectedCount} ${visualizationWord}. You need to resolve these dependencies before deleting.`
              : `Are you sure you want to delete "${itemName}"? This action cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        {hasAffectedVisualizations && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              For each visualization, choose to remove this {itemType} from its
              encoding or delete the visualization entirely:
            </p>
            <div className="space-y-2">
              {affectedVisualizations.map(
                ({ visualization, affectedChannels }) => (
                  <div
                    key={visualization.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {visualization.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Used in: {affectedChannels.join(", ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        label="Remove"
                        icon={CloseIcon}
                        variant="outlined"
                        size="sm"
                        onClick={() =>
                          onRemoveFromVisualization(visualization.id)
                        }
                        disabled={processingVizId !== null}
                      />
                      <Button
                        label="Delete"
                        icon={DeleteIcon}
                        color="danger"
                        size="sm"
                        onClick={() => onDeleteVisualization(visualization.id)}
                        disabled={processingVizId !== null}
                      />
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button label="Cancel" variant="outlined" onClick={onClose} />
          <Button
            label={`Delete ${itemType}`}
            color="danger"
            onClick={handleDelete}
            disabled={hasAffectedVisualizations}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find all visualizations that use a specific field.
 */
export function findVisualizationsUsingField(
  fieldId: string,
  visualizations: Visualization[],
): AffectedVisualization[] {
  const targetEncoding = fieldEncoding(fieldId);
  const results: AffectedVisualization[] = [];

  for (const viz of visualizations) {
    const enc = viz.encoding;
    if (!enc) continue;

    const affectedChannels: (keyof VisualizationEncoding)[] = [];
    if (enc.x === targetEncoding) affectedChannels.push("x");
    if (enc.y === targetEncoding) affectedChannels.push("y");
    if (enc.color === targetEncoding) affectedChannels.push("color");
    if (enc.size === targetEncoding) affectedChannels.push("size");

    if (affectedChannels.length > 0) {
      results.push({ visualization: viz, affectedChannels });
    }
  }

  return results;
}

/**
 * Find all visualizations that use a specific metric.
 */
export function findVisualizationsUsingMetric(
  metricId: string,
  visualizations: Visualization[],
): AffectedVisualization[] {
  const targetEncoding = metricEncoding(metricId);
  const results: AffectedVisualization[] = [];

  for (const viz of visualizations) {
    const enc = viz.encoding;
    if (!enc) continue;

    const affectedChannels: (keyof VisualizationEncoding)[] = [];
    if (enc.x === targetEncoding) affectedChannels.push("x");
    if (enc.y === targetEncoding) affectedChannels.push("y");
    if (enc.color === targetEncoding) affectedChannels.push("color");
    if (enc.size === targetEncoding) affectedChannels.push("size");

    if (affectedChannels.length > 0) {
      results.push({ visualization: viz, affectedChannels });
    }
  }

  return results;
}

/**
 * Create a new encoding with the specified field/metric removed.
 * Clears the channels that used this item.
 */
export function removeFromEncoding(
  encoding: VisualizationEncoding | undefined,
  itemId: string,
  itemType: DeleteItemType,
): VisualizationEncoding {
  if (!encoding) return {};

  const targetEncoding =
    itemType === "field" ? fieldEncoding(itemId) : metricEncoding(itemId);

  const newEncoding = { ...encoding };

  // Clear channels that use this item
  if (newEncoding.x === targetEncoding) {
    delete newEncoding.x;
    delete newEncoding.xType;
    delete newEncoding.xTransform;
  }
  if (newEncoding.y === targetEncoding) {
    delete newEncoding.y;
    delete newEncoding.yType;
    delete newEncoding.yTransform;
  }
  if (newEncoding.color === targetEncoding) {
    delete newEncoding.color;
  }
  if (newEncoding.size === targetEncoding) {
    delete newEncoding.size;
  }

  return newEncoding;
}
