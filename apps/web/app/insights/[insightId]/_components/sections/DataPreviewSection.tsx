"use client";

import { memo, useState, useMemo, useCallback } from "react";
import {
  Section,
  Toggle,
  VirtualTable,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
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
 * Performance optimization: Only initializes the hook for the current preview mode.
 * The other mode's hook is lazily initialized when the user switches modes.
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
  const initialMode: PreviewMode = hasConfiguration ? "result" : "join";

  // Combined state: current mode + set of activated modes
  // This avoids the need for useEffect to sync activated modes
  const [modeState, setModeState] = useState<{
    current: PreviewMode;
    activated: Set<PreviewMode>;
  }>(() => ({
    current: initialMode,
    activated: new Set([initialMode]),
  }));

  const previewMode = modeState.current;

  // Custom setter that also marks modes as activated
  const setPreviewMode = useCallback((mode: PreviewMode) => {
    setModeState((prev) => ({
      current: mode,
      activated: new Set([...prev.activated, mode]),
    }));
  }, []);

  // Check if a mode is activated (for lazy hook initialization)
  const isJoinActivated = modeState.activated.has("join");
  const isResultActivated = modeState.activated.has("result");

  // Only run hooks for activated modes (lazy initialization)
  // This prevents the expensive ensureTableLoaded from running twice on initial load
  const joinPagination = useInsightPagination({
    insight,
    showModelPreview: true,
    enabled: isJoinActivated,
  });

  const resultPagination = useInsightPagination({
    insight,
    showModelPreview: false,
    enabled: isResultActivated,
  });

  // Select the active pagination based on mode
  const activePagination =
    previewMode === "join" ? joinPagination : resultPagination;
  const { fetchData, totalCount, fieldCount, isReady, columnDisplayNames } =
    activePagination;

  // Build column configs for VirtualTable to show human-readable headers
  // This maps UUID column aliases (field_<uuid>) to display names
  const columnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    return Object.entries(columnDisplayNames).map(([id, label]) => ({
      id,
      label,
    }));
  }, [columnDisplayNames]);

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

  // Build description with row and field counts, or show loading stage
  const description = isReady
    ? `${displayRowCount.toLocaleString()} rows • ${displayFieldCount} fields`
    : "Loading data...";

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
      <VirtualTable
        onFetchData={fetchData}
        columnConfigs={columnConfigs}
        height={260}
        compact
      />
    </Section>
  );
});
