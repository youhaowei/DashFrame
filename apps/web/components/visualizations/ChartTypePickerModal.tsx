"use client";

import { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@dashframe/ui";
import type { Field } from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type { Insight } from "@/lib/stores/types";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { ChartTypePicker } from "./ChartTypePicker";

interface ChartTypePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** DuckDB table name for chart preview */
  tableName: string;
  /** Insight object for suggestion generation */
  insight: Insight;
  /** Column analysis from DuckDB */
  columnAnalysis: ColumnAnalysis[];
  /** Total row count */
  rowCount: number;
  /** Field definitions */
  fieldMap: Record<string, Field>;
  /** Existing field names in the insight */
  existingFields: string[];
  /** Callback when a chart is created */
  onCreateChart: (suggestion: ChartSuggestion) => void;
  /** Whether chart view is still loading */
  isLoading?: boolean;
  /** Seed for shuffling chart suggestions */
  suggestionSeed?: number;
  /** Callback to regenerate suggestions with a new seed */
  onRegenerate?: () => void;
}

/**
 * Modal for selecting a chart type when creating a visualization.
 *
 * Wraps ChartTypePicker in a Dialog for use when visualizations already exist.
 * For unconfigured insights with no visualizations, use ChartTypePicker directly.
 */
export function ChartTypePickerModal({
  isOpen,
  onClose,
  tableName,
  insight,
  columnAnalysis,
  rowCount,
  fieldMap,
  existingFields,
  onCreateChart,
  isLoading = false,
  suggestionSeed = 0,
  onRegenerate,
}: ChartTypePickerModalProps) {
  // Wrap onCreateChart to also close the modal
  const handleCreateChart = useCallback(
    (suggestion: ChartSuggestion) => {
      onCreateChart(suggestion);
      onClose();
    },
    [onCreateChart, onClose],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="xl"
        className="w-[max(900px,50vw)] max-w-[calc(100%-2rem)]"
      >
        <DialogHeader>
          <DialogTitle>Create visualization</DialogTitle>
          <DialogDescription>
            Choose a chart type to visualize your data
          </DialogDescription>
        </DialogHeader>

        {/* Grid with 4 columns for wider dialog, vertical scroll if needed */}
        <div className="max-h-[60vh] overflow-y-auto pt-4">
          <ChartTypePicker
            tableName={tableName}
            insight={insight}
            columnAnalysis={columnAnalysis}
            rowCount={rowCount}
            fieldMap={fieldMap}
            existingFields={existingFields}
            onCreateChart={handleCreateChart}
            gridColumns={4}
            isLoading={isLoading}
            suggestionSeed={suggestionSeed}
            onRegenerate={onRegenerate}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
