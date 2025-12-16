"use client";

import { memo, useCallback } from "react";
import { Section, Badge } from "@dashframe/ui";
import { Hash, Calculator, X } from "@dashframe/ui/icons";
import { useInsightMutations } from "@dashframe/core";
import type { Insight, Field, InsightMetric } from "@dashframe/types";

interface ConfigurationPanelProps {
  insight: Insight;
  selectedFields: Field[];
  visibleMetrics: InsightMetric[];
}

/**
 * ConfigurationPanel - Shows selected fields and metrics
 *
 * Displays configured dimensions (fields) and metrics with remove actions.
 * Each field/metric is shown as a badge with type info and remove button.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const ConfigurationPanel = memo(function ConfigurationPanel({
  insight,
  selectedFields,
  visibleMetrics,
}: ConfigurationPanelProps) {
  const { update: updateInsight } = useInsightMutations();

  const handleRemoveField = useCallback(
    async (fieldId: string) => {
      const updatedFields = (insight.selectedFields || []).filter(
        (id) => id !== fieldId,
      );
      await updateInsight(insight.id, { selectedFields: updatedFields });
    },
    [insight.id, insight.selectedFields, updateInsight],
  );

  const handleRemoveMetric = useCallback(
    async (metricId: string) => {
      const updatedMetrics = (insight.metrics || []).filter(
        (m) => m.id !== metricId,
      );
      await updateInsight(insight.id, { metrics: updatedMetrics });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  return (
    <div className="space-y-6">
      {/* Fields (Dimensions) */}
      <Section title="Fields (Dimensions)" description="Columns to group by">
        {selectedFields.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedFields.map((field) => {
              const isJoined = (field as Field & { _isJoined?: boolean })
                ._isJoined;
              return (
                <Badge
                  key={field.id}
                  variant="secondary"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
                >
                  <Hash className="h-3 w-3" />
                  <span>{field.name}</span>
                  <span className="text-muted-foreground text-[10px]">
                    {field.type}
                  </span>
                  <span className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
                    {isJoined ? "joined" : "base"}
                  </span>
                  <button
                    onClick={() => handleRemoveField(field.id)}
                    className="hover:bg-muted ml-0.5 rounded-full p-0.5"
                    aria-label={`Remove ${field.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No fields selected. Click a column header in the preview table to
            add.
          </p>
        )}
      </Section>

      {/* Metrics */}
      <Section title="Metrics" description="Aggregations to compute">
        {visibleMetrics.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {visibleMetrics.map((metric) => (
              <Badge
                key={metric.id}
                variant="secondary"
                className="bg-primary/10 text-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
              >
                <Calculator className="h-3 w-3" />
                <span>{metric.name}</span>
                <span className="text-primary/60 text-[10px]">
                  {metric.aggregation}
                </span>
                <span className="bg-primary/20 rounded px-1.5 py-0.5 text-[10px]">
                  base
                </span>
                <button
                  onClick={() => handleRemoveMetric(metric.id)}
                  className="hover:bg-primary/20 ml-0.5 rounded-full p-0.5"
                  aria-label={`Remove ${metric.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No metrics configured. Click a column header in the preview table to
            add.
          </p>
        )}
      </Section>
    </div>
  );
});
