"use client";

import { memo, useState, useMemo } from "react";
import { Section, Toggle, VirtualTable } from "@dashframe/ui";
import { GitMerge, Table2 } from "@dashframe/ui/icons";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import type { Insight } from "@dashframe/types";

type PreviewMode = "join" | "result";

interface DataPreviewSectionProps {
  insight: Insight;
  combinedFieldCount: number;
}

/**
 * DataPreviewSection - Data preview with toggle between Join Preview and Insight Result
 *
 * Two preview modes:
 * - Join Preview: Shows raw joined data without aggregations/filters (showModelPreview=true)
 * - Insight Result: Shows aggregated/filtered data based on insight configuration (showModelPreview=false)
 *
 * The toggle is only shown when the insight has configuration (fields or metrics selected).
 * When unconfigured, defaults to Join Preview mode.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const DataPreviewSection = memo(function DataPreviewSection({
  insight,
  combinedFieldCount,
}: DataPreviewSectionProps) {
  // Determine if insight has configuration (fields or metrics)
  const hasConfiguration =
    (insight.selectedFields?.length ?? 0) > 0 ||
    (insight.metrics?.length ?? 0) > 0;

  // Default to "result" mode if insight has configuration, otherwise "join"
  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    hasConfiguration ? "result" : "join",
  );

  // Use insight pagination for join preview (raw data)
  const joinPagination = useInsightPagination({
    insight,
    showModelPreview: true,
  });

  // Use insight pagination for insight result (aggregated data)
  const resultPagination = useInsightPagination({
    insight,
    showModelPreview: false,
  });

  // Select the active pagination based on mode
  const activePagination =
    previewMode === "join" ? joinPagination : resultPagination;
  const { fetchData, totalCount, fieldCount, isReady } = activePagination;

  // Compute display counts
  const displayRowCount = totalCount || 0;
  const displayFieldCount =
    previewMode === "join" ? combinedFieldCount : fieldCount || 0;

  // Toggle options - icons sized by Toggle component based on size prop
  const toggleOptions = useMemo(
    () => [
      {
        value: "join" as const,
        icon: <GitMerge />,
        label: "Join preview",
        tooltip: "Raw data from joined tables",
      },
      {
        value: "result" as const,
        icon: <Table2 />,
        label: "Insight result",
        tooltip: "Aggregated data based on insight configuration",
        disabled: !hasConfiguration,
      },
    ],
    [hasConfiguration],
  );

  // Build description with row and field counts
  const description = `${displayRowCount.toLocaleString()} rows • ${displayFieldCount} fields`;

  return (
    <Section
      title="Data preview"
      description={description}
      isLoading={!isReady}
      loadingHeight={300}
      headerRight={
        hasConfiguration ? (
          <Toggle
            variant="outline"
            size="sm"
            value={previewMode}
            options={toggleOptions}
            onValueChange={setPreviewMode}
          />
        ) : undefined
      }
    >
      <VirtualTable onFetchData={fetchData} height={260} compact />
    </Section>
  );
});
