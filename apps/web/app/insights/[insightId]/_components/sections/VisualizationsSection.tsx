"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Section, ItemList, type ListItem } from "@dashframe/ui";
import { BarChart3, Plus } from "@dashframe/ui/icons";
import type { Visualization, Field } from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import { VisualizationItemCard } from "@/components/visualizations/VisualizationItemCard";
import { ChartTypePickerModal } from "@/components/visualizations/ChartTypePickerModal";
import type { Insight } from "@/lib/stores/types";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";

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
}

/** Extended ListItem that includes the full visualization object */
interface VisualizationListItem extends ListItem {
  visualization: Visualization;
}

/**
 * VisualizationsSection - Shows grid of created visualizations
 *
 * Displays all visualizations created from this insight using ItemList grid.
 * Each card shows a live chart preview and creation date.
 * Clicking a visualization navigates to its detail page.
 *
 * Uses custom renderItem to display VisualizationItemCard instead of default ItemCard.
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

  // Convert visualizations to extended ListItem format
  const items: VisualizationListItem[] = useMemo(
    () =>
      visualizations.map((viz) => ({
        id: viz.id,
        title: viz.name,
        visualization: viz,
      })),
    [visualizations],
  );

  // Custom render function for visualization cards
  const renderVisualizationCard = useCallback(
    (item: VisualizationListItem, onClick: () => void) => (
      <VisualizationItemCard
        visualization={item.visualization}
        onClick={onClick}
        previewHeight={140}
      />
    ),
    [],
  );

  // Check if we have the required props for the modal
  const canShowModal = tableName && insight;

  return (
    <>
      <Section
        title="Visualizations"
        actions={[
          {
            label: "Create visualization",
            icon: Plus,
            variant: "outline",
            onClick: handleCreateVisualization,
            disabled: !canShowModal,
          },
        ]}
      >
        <ItemList
          items={items}
          onSelect={handleSelectVisualization}
          orientation="grid"
          gap={16}
          emptyMessage="Create a visualization to see your data come to life"
          emptyIcon={<BarChart3 className="h-8 w-8" />}
          renderItem={renderVisualizationCard}
        />
      </Section>

      {/* Chart type picker modal */}
      {canShowModal && (
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
        />
      )}
    </>
  );
});
