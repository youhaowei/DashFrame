"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Input } from "@dashframe/ui";
import { AppLayout } from "@/components/layouts/AppLayout";
import {
  useInsightMutations,
  useDataTables,
  useDataFrames,
  useVisualizations,
} from "@dashframe/core";
import type { Insight } from "@dashframe/types";
import { NotFoundView } from "./NotFoundView";
import { DataSourcesSection } from "./sections/DataSourcesSection";
import { DataPreviewSection } from "./sections/DataPreviewSection";
import { ConfigurationPanel } from "./sections/ConfigurationPanel";
import { SuggestedChartsSection } from "./sections/SuggestedChartsSection";
import { VisualizationsSection } from "./sections/VisualizationsSection";

interface InsightViewProps {
  insight: Insight;
}

/**
 * InsightView - Unified view for insight page
 *
 * Single-page layout (no tabs) with modular sections:
 * - Data sources
 * - Data preview
 * - Configuration (fields, metrics)
 * - Chart suggestions
 * - Visualizations
 *
 * Performance optimizations:
 * - Local state for insight name with debounced updates
 * - Sections only re-render when their specific data changes
 */
export function InsightView({ insight }: InsightViewProps) {
  const insightId = insight.id;

  // Local state for insight name (prevents re-renders on typing)
  const [localName, setLocalName] = useState(insight.name);
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>();

  // Sync local name when insight prop changes from external source
  useEffect(() => {
    setLocalName(insight.name);
  }, [insight.name]);

  // Mutations
  const { update: updateInsight } = useInsightMutations();

  // Debounced save for insight name (500ms after typing stops)
  const handleNameChange = useCallback(
    (newName: string) => {
      setLocalName(newName);

      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout to save after 500ms of no typing
      saveTimeoutRef.current = setTimeout(() => {
        if (newName !== insight.name) {
          updateInsight(insightId, { name: newName });
        }
      }, 500);
    },
    [insightId, insight.name, updateInsight],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Fetch related data
  const { data: allDataTables = [] } = useDataTables();
  const { data: allDataFrameEntries = [] } = useDataFrames();
  const { data: allVisualizations = [] } = useVisualizations();

  // Find data table
  const dataTable = useMemo(
    () => allDataTables.find((t) => t.id === insight.baseTableId),
    [allDataTables, insight.baseTableId],
  );

  // Compute metadata
  const baseDataFrameEntry = useMemo(
    () =>
      dataTable?.dataFrameId
        ? allDataFrameEntries.find((e) => e.id === dataTable.dataFrameId)
        : undefined,
    [allDataFrameEntries, dataTable?.dataFrameId],
  );

  const rowCount = baseDataFrameEntry?.rowCount ?? 0;
  const fieldCount =
    dataTable?.fields?.filter((f) => !f.name.startsWith("_")).length ?? 0;

  // Get visualizations for this insight
  const insightVisualizations = useMemo(
    () => allVisualizations.filter((v) => v.insightId === insightId),
    [allVisualizations, insightId],
  );

  // Get selected fields
  const selectedFields = useMemo(() => {
    if (!dataTable) return [];
    return (dataTable.fields ?? []).filter(
      (f) => insight.selectedFields?.includes(f.id) && !f.name.startsWith("_"),
    );
  }, [dataTable, insight.selectedFields]);

  // Get visible metrics
  const visibleMetrics = useMemo(
    () => (insight.metrics ?? []).filter((m) => !m.name.startsWith("_")),
    [insight.metrics],
  );

  // Determine if insight is configured (has fields or metrics)
  const isConfigured =
    (insight.selectedFields?.length ?? 0) > 0 ||
    (insight.metrics?.length ?? 0) > 0;

  // TODO: Implement chart suggestions logic
  // For now, use empty array
  const suggestions = [];
  const handleCreateChart = useCallback(() => {
    console.log("Create chart from suggestion");
  }, []);
  const handleRegenerate = useCallback(() => {
    console.log("Regenerate suggestions");
  }, []);

  // Data table not found - check after all hooks are called
  if (!dataTable) {
    return <NotFoundView type="dataTable" />;
  }

  return (
    <AppLayout
      breadcrumbs={[
        { label: "Insights", href: "/insights" },
        { label: localName || "Untitled" },
      ]}
      headerContent={
        <div className="flex-1">
          <Input
            value={localName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Insight name"
            className="text-2xl font-semibold"
          />
        </div>
      }
    >
      {/* Main content - unified view */}
      <div className="container mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* Data Sources */}
        <DataSourcesSection
          insight={insight}
          dataTable={dataTable}
          allDataTables={allDataTables}
          allTableFields={dataTable?.fields ?? []}
        />

        {/* Data Preview */}
        <DataPreviewSection
          dataTable={dataTable}
          rowCount={rowCount}
          fieldCount={fieldCount}
        />

        {/* Configuration Panel - Only show if configured */}
        {isConfigured && (
          <ConfigurationPanel
            insight={insight}
            selectedFields={selectedFields}
            visibleMetrics={visibleMetrics}
          />
        )}

        {/* Suggested Charts - Only show if not configured */}
        {!isConfigured && dataTable.dataFrameId && (
          <SuggestedChartsSection
            tableName={`df_${dataTable.dataFrameId}`}
            suggestions={suggestions}
            isLoading={false}
            onCreateChart={handleCreateChart}
            onRegenerate={handleRegenerate}
          />
        )}

        {/* Visualizations - Only show if there are visualizations */}
        {insightVisualizations.length > 0 && (
          <VisualizationsSection
            visualizations={insightVisualizations}
            insightId={insightId}
          />
        )}
      </div>
    </AppLayout>
  );
}
