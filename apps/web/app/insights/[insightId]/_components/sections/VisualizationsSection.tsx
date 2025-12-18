"use client";

import { memo, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Section, ItemList, type ListItem } from "@dashframe/ui";
import { BarChart3, Plus } from "@dashframe/ui/icons";
import type { Visualization } from "@dashframe/types";
import { VisualizationItemCard } from "@/components/visualizations/VisualizationItemCard";

interface VisualizationsSectionProps {
  visualizations: Visualization[];
  insightId: string;
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
  insightId,
}: VisualizationsSectionProps) {
  const router = useRouter();

  const handleSelectVisualization = useCallback(
    (vizId: string) => {
      router.push(`/visualizations/${vizId}`);
    },
    [router],
  );

  const handleCreateVisualization = useCallback(() => {
    // TODO(visualization-creation): Implement create visualization flow
    console.log("Create visualization for insight:", insightId);
  }, [insightId]);

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

  return (
    <Section
      title="Visualizations"
      actions={[
        {
          label: "Create visualization",
          icon: Plus,
          variant: "outline",
          onClick: handleCreateVisualization,
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
  );
});
