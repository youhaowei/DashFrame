import { ItemCard } from "@dashframe/ui";
import { Lightbulb } from "@dashframe/ui/icons";
import type { InsightInfo } from "@/hooks/useInsights";

export interface InsightListProps {
  /**
   * List of insights to display
   */
  insights: InsightInfo[];
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
 *
 * @example
 * ```tsx
 * const { insights } = useInsights({ withComputedDataOnly: true });
 *
 * <InsightList
 *   insights={insights}
 *   onInsightClick={(id, name) => handleSelect(id)}
 * />
 * ```
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
