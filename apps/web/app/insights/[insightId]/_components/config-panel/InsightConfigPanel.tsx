"use client";

import { useState, useCallback, useMemo } from "react";
import { Panel, Input, InputField } from "@dashframe/ui";
import { useInsightMutations } from "@dashframe/core";
import type { Insight, DataTable, InsightMetric } from "@dashframe/types";
import {
  computeCombinedFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import { FieldsSection } from "./FieldsSection";
import { MetricsSection } from "./MetricsSection";
import { InsightFieldEditorModal } from "./InsightFieldEditorModal";
import { InsightMetricEditorModal } from "./InsightMetricEditorModal";

interface InsightConfigPanelProps {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  name: string;
  onNameChange: (name: string) => void;
}

/**
 * InsightConfigPanel - Left panel for configuring insight fields and metrics
 *
 * Features:
 * - Editable insight name in header
 * - Grouped sections for Fields (dimensions) and Metrics (aggregations)
 * - Drag-and-drop reordering via @dnd-kit
 * - Add/edit/remove functionality via dialog modals
 */
export function InsightConfigPanel({
  insight,
  dataTable,
  allDataTables,
  name,
  onNameChange,
}: InsightConfigPanelProps) {
  // Modal states
  const [isFieldEditorOpen, setIsFieldEditorOpen] = useState(false);
  const [isMetricEditorOpen, setIsMetricEditorOpen] = useState(false);

  // Mutations
  const { update: updateInsight } = useInsightMutations();

  // Compute combined fields from base + joined tables
  const { fields: combinedFields } = useMemo(
    () => computeCombinedFields(dataTable, insight.joins, allDataTables),
    [dataTable, insight.joins, allDataTables],
  );

  // Get selected fields in order (preserving insight.selectedFields order)
  const selectedFields = useMemo(() => {
    const fieldMap = new Map(combinedFields.map((f) => [f.id, f]));
    return (insight.selectedFields ?? [])
      .map((id) => fieldMap.get(id))
      .filter((f): f is CombinedField => f !== undefined);
  }, [combinedFields, insight.selectedFields]);

  // Get available fields (not yet selected)
  const availableFields = useMemo(() => {
    const selectedIds = new Set(insight.selectedFields ?? []);
    return combinedFields.filter((f) => !selectedIds.has(f.id));
  }, [combinedFields, insight.selectedFields]);

  // Get visible metrics (exclude internal ones)
  const visibleMetrics = useMemo(
    () => (insight.metrics ?? []).filter((m) => !m.name.startsWith("_")),
    [insight.metrics],
  );

  // --- Field handlers ---
  const handleFieldsReorder = useCallback(
    (newOrder: string[]) => {
      updateInsight(insight.id, { selectedFields: newOrder });
    },
    [insight.id, updateInsight],
  );

  const handleRemoveField = useCallback(
    (fieldId: string) => {
      const updated = (insight.selectedFields ?? []).filter(
        (id) => id !== fieldId,
      );
      updateInsight(insight.id, { selectedFields: updated });
    },
    [insight.id, insight.selectedFields, updateInsight],
  );

  const handleAddField = useCallback(
    (fieldId: string) => {
      const updated = [...(insight.selectedFields ?? []), fieldId];
      updateInsight(insight.id, { selectedFields: updated });
    },
    [insight.id, insight.selectedFields, updateInsight],
  );

  // --- Metric handlers ---
  const handleMetricsReorder = useCallback(
    (newOrder: InsightMetric[]) => {
      updateInsight(insight.id, { metrics: newOrder });
    },
    [insight.id, updateInsight],
  );

  const handleRemoveMetric = useCallback(
    (metricId: string) => {
      const updated = (insight.metrics ?? []).filter((m) => m.id !== metricId);
      updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  const handleAddMetric = useCallback(
    (metric: InsightMetric) => {
      const updated = [...(insight.metrics ?? []), metric];
      updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  return (
    <Panel
      header={
        <div className="p-4">
          <InputField
            label="Name"
            value={name}
            onChange={onNameChange}
            placeholder="Insight name"
            className="text-lg font-semibold"
          />
        </div>
      }
    >
      <div className="space-y-0">
        {/* Fields Section */}
        <FieldsSection
          selectedFields={selectedFields}
          selectedFieldIds={insight.selectedFields ?? []}
          baseTableId={dataTable.id}
          onReorder={handleFieldsReorder}
          onRemove={handleRemoveField}
          onAddClick={() => setIsFieldEditorOpen(true)}
        />

        {/* Metrics Section */}
        <MetricsSection
          metrics={visibleMetrics}
          onReorder={handleMetricsReorder}
          onRemove={handleRemoveMetric}
          onAddClick={() => setIsMetricEditorOpen(true)}
        />
      </div>

      <InsightFieldEditorModal
        isOpen={isFieldEditorOpen}
        onOpenChange={setIsFieldEditorOpen}
        availableFields={availableFields}
        baseTableId={dataTable.id}
        onSelect={handleAddField}
      />
      <InsightMetricEditorModal
        isOpen={isMetricEditorOpen}
        onOpenChange={setIsMetricEditorOpen}
        dataTable={dataTable}
        insightId={insight.id}
        onSave={handleAddMetric}
      />
    </Panel>
  );
}
