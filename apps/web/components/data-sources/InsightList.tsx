import { ItemCard, Lightbulb } from "@dashframe/ui";

/**
 * Display info for an insight in the list.
 */
export interface InsightDisplayInfo {
  id: string;
  name: string;
  rowCount?: number;
  metricCount: number;
}

export interface InsightListProps {
  /**
   * List of insights to display
   */
  insights: InsightDisplayInfo[];
  /**
   * Callback when an insight is clicked
   */
  onInsightClick: (insightId: string, insightName: string) => void;
}

/**
 * Displays a list of insights as clickable cards.
 *
 * Shows insights that have computed DataFrames for chaining.
 * Used in DataPickerContent to allow users to build on existing work.
 */
export function InsightList({ insights, onInsightClick }: InsightListProps) {
  return (
    <>
      {insights.map((insight) => (
        <ItemCard
          key={insight.id}
          icon={<Lightbulb className="h-4 w-4" />}
          title={insight.name}
          subtitle={`${insight.rowCount ?? "?"} rows • ${insight.metricCount} metrics`}
          badge="Insight"
          onClick={() => onInsightClick(insight.id, insight.name)}
        />
      ))}
    </>
  );
}
