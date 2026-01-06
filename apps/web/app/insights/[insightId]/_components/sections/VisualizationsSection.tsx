"use client";

import { ChartTypePicker } from "@/components/visualizations/ChartTypePicker";
import { ChartTypePickerModal } from "@/components/visualizations/ChartTypePickerModal";
import { VisualizationItemCard } from "@/components/visualizations/VisualizationItemCard";
import type { Insight } from "@/lib/stores/types";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type { Field, Visualization } from "@dashframe/types";
import {
  ItemList,
  Section,
  type ItemAction,
  type ListItem,
} from "@dashframe/ui";
import { ChartIcon, CopyIcon, DeleteIcon, PlusIcon } from "@dashframe/ui/icons";
import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useState } from "react";

interface VisualizationsSectionProps {
  visualizations: Visualization[];
  /** DuckDB table name for chart previews */
  tableName?: string;
  /** Insight object for suggestion generation */
  insight?: Insight;
  /** Column analysis from DuckDB */
  columnAnalysis?: ColumnAnalysis[];
  /** Total row count */
  rowCount?: number;
  /** Field definitions */
  fieldMap?: Record<string, Field>;
  /** Existing field names in the insight */
  existingFields?: string[];
  /** Callback when a chart is created */
  onCreateChart?: (suggestion: ChartSuggestion) => void;
  /** Callback when a visualization is duplicated */
  onDuplicateVisualization?: (vizId: string) => void;
  /** Callback when a visualization is deleted */
  onDeleteVisualization?: (vizId: string, name: string) => void;
  /** Whether chart view is still loading (shows skeletons) */
  isChartViewLoading?: boolean;
  /** Seed for shuffling chart suggestions */
  suggestionSeed?: number;
  /** Callback to regenerate suggestions with a new seed */
  onRegenerate?: () => void;
}

/** Extended ListItem that includes the full visualization object and actions */
interface VisualizationListItem extends ListItem {
  visualization: Visualization;
  actions?: ItemAction[];
}

/**
 * VisualizationsSection - Shows visualizations or creation flow
 *
 * Two states:
 * 1. Empty state (no visualizations): Shows inline ChartTypePicker grid
 *    for immediate chart creation without modal.
 * 2. Has visualizations: Shows grid of existing visualizations with
 *    "Create visualization" button that opens modal.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const VisualizationsSection = memo(function VisualizationsSection({
  visualizations,
  tableName,
  insight,
  columnAnalysis = [],
  rowCount = 0,
  fieldMap = {},
  existingFields = [],
  onCreateChart,
  onDuplicateVisualization,
  onDeleteVisualization,
  isChartViewLoading = false,
  suggestionSeed = 0,
  onRegenerate,
}: VisualizationsSectionProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSelectVisualization = useCallback(
    (vizId: string) => {
      router.push(`/visualizations/${vizId}`);
    },
    [router],
  );

  const handleCreateVisualization = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleCreateChart = useCallback(
    (suggestion: ChartSuggestion) => {
      if (onCreateChart) {
        onCreateChart(suggestion);
      }
      setIsModalOpen(false);
    },
    [onCreateChart],
  );

  // Convert visualizations to extended ListItem format with actions
  const items: VisualizationListItem[] = useMemo(
    () =>
      visualizations.map((viz) => {
        const actions: ItemAction[] = [];

        if (onDuplicateVisualization) {
          actions.push({
            icon: CopyIcon,
            label: "Duplicate",
            onClick: () => onDuplicateVisualization(viz.id),
          });
        }

        if (onDeleteVisualization) {
          actions.push({
            icon: DeleteIcon,
            label: "Delete",
            onClick: () => onDeleteVisualization(viz.id, viz.name),
            color: "danger" as const,
          });
        }

        return {
          id: viz.id,
          title: viz.name,
          visualization: viz,
          actions: actions.length > 0 ? actions : undefined,
        };
      }),
    [visualizations, onDuplicateVisualization, onDeleteVisualization],
  );

  // Custom render function for visualization cards
  const renderVisualizationCard = useCallback(
    (item: VisualizationListItem, onClick: () => void) => (
      <VisualizationItemCard
        visualization={item.visualization}
        onClick={onClick}
        previewHeight={140}
        actions={item.actions}
      />
    ),
    [],
  );

  // Check if we have the required props for chart creation
  const canCreateChart = tableName && insight && onCreateChart;
  const hasVisualizations = visualizations.length > 0;

  // Empty state: show inline chart type picker
  if (!hasVisualizations && canCreateChart) {
    return (
      <Section
        title="Create visualization"
        description="Select a chart type to get started"
      >
        <ChartTypePicker
          tableName={tableName}
          insight={insight}
          columnAnalysis={columnAnalysis}
          rowCount={rowCount}
          fieldMap={fieldMap}
          existingFields={existingFields}
          onCreateChart={onCreateChart}
          gridColumns={3}
          isLoading={isChartViewLoading}
          suggestionSeed={suggestionSeed}
          onRegenerate={onRegenerate}
        />
      </Section>
    );
  }

  // Has visualizations: show grid with "Create visualization" button
  return (
    <>
      <Section
        title="Visualizations"
        actions={
          canCreateChart
            ? [
                {
                  label: "Create visualization",
                  icon: PlusIcon,
                  variant: "outlined",
                  onClick: handleCreateVisualization,
                },
              ]
            : undefined
        }
      >
        <ItemList
          items={items}
          onSelect={handleSelectVisualization}
          orientation="grid"
          gap={16}
          emptyMessage="Create a visualization to see your data come to life"
          emptyIcon={<ChartIcon className="h-8 w-8" />}
          renderItem={renderVisualizationCard}
        />
      </Section>

      {/* Chart type picker modal - only used when visualizations exist */}
      {canCreateChart && (
        <ChartTypePickerModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          tableName={tableName}
          insight={insight}
          columnAnalysis={columnAnalysis}
          rowCount={rowCount}
          fieldMap={fieldMap}
          existingFields={existingFields}
          onCreateChart={handleCreateChart}
          isLoading={isChartViewLoading}
          suggestionSeed={suggestionSeed}
          onRegenerate={onRegenerate}
        />
      )}
    </>
  );
});
