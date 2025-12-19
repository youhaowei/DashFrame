"use client";

import { useState, useCallback, useMemo } from "react";
import { Panel, InputField } from "@dashframe/ui";
import {
  useInsightMutations,
  useVisualizations,
  useDataTableMutations,
} from "@dashframe/core";
import type {
  Insight,
  DataTable,
  InsightMetric,
  Visualization,
} from "@dashframe/types";
import {
  computeCombinedFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import { FieldsSection } from "./FieldsSection";
import { MetricsSection } from "./MetricsSection";
import { InsightFieldEditorModal } from "./InsightFieldEditorModal";
import { InsightMetricEditorModal } from "./InsightMetricEditorModal";
import { FieldRenameDialog } from "./FieldRenameDialog";
import { MetricEditDialog } from "./MetricEditDialog";

/**
 * Check if a field (by column name) is used by any visualization's encoding
 */
function isFieldUsedByVisualization(
  columnName: string,
  visualizations: Visualization[],
): Visualization | undefined {
  return visualizations.find((viz) => {
    const enc = viz.encoding;
    if (!enc) return false;
    // Check if encoding x/y/color/size references this column (as dimension)
    return (
      enc.x === columnName ||
      enc.y === columnName ||
      enc.color === columnName ||
      enc.size === columnName
    );
  });
}

/**
 * Check if a metric (by name like "sum(amount)") is used by any visualization's encoding
 */
function isMetricUsedByVisualization(
  metricName: string,
  visualizations: Visualization[],
): Visualization | undefined {
  return visualizations.find((viz) => {
    const enc = viz.encoding;
    if (!enc) return false;
    // Metrics appear in encoding as aggregate expressions like "sum(amount)"
    return (
      enc.x === metricName ||
      enc.y === metricName ||
      enc.color === metricName ||
      enc.size === metricName
    );
  });
}

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
  const [fieldToRename, setFieldToRename] = useState<CombinedField | null>(
    null,
  );
  const [metricToEdit, setMetricToEdit] = useState<InsightMetric | null>(null);

  // Mutations
  const { update: updateInsight } = useInsightMutations();
  const { updateField } = useDataTableMutations();

  // Get visualizations for this insight to check dependencies
  const { data: insightVisualizations = [] } = useVisualizations(insight.id);

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
      // Find the field to get its column name
      const field = combinedFields.find((f) => f.id === fieldId);
      if (!field) return;

      const columnName = field.columnName ?? field.name;

      // Check if any visualization uses this field
      const usingViz = isFieldUsedByVisualization(
        columnName,
        insightVisualizations,
      );
      if (usingViz) {
        alert(
          `Cannot remove field "${field.name}" because it is used by visualization "${usingViz.name}". Delete the visualization first.`,
        );
        return;
      }

      const updated = (insight.selectedFields ?? []).filter(
        (id) => id !== fieldId,
      );
      updateInsight(insight.id, { selectedFields: updated });
    },
    [
      insight.id,
      insight.selectedFields,
      updateInsight,
      combinedFields,
      insightVisualizations,
    ],
  );

  const handleAddField = useCallback(
    (fieldId: string) => {
      const updated = [...(insight.selectedFields ?? []), fieldId];
      updateInsight(insight.id, { selectedFields: updated });
    },
    [insight.id, insight.selectedFields, updateInsight],
  );

  const handleRenameField = useCallback(
    async (field: CombinedField, newName: string) => {
      // Update the display name in the source DataTable
      // This only changes the user-facing name, not the underlying columnName
      try {
        await updateField(field.sourceTableId, field.id, { name: newName });
      } catch (error) {
        console.error("Failed to rename field:", error);
        alert("Failed to rename field. Please try again.");
      }
    },
    [updateField],
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
      // Find the metric to get its name
      const metric = (insight.metrics ?? []).find((m) => m.id === metricId);
      if (!metric) return;

      // Check if any visualization uses this metric
      const usingViz = isMetricUsedByVisualization(
        metric.name,
        insightVisualizations,
      );
      if (usingViz) {
        alert(
          `Cannot remove metric "${metric.name}" because it is used by visualization "${usingViz.name}". Delete the visualization first.`,
        );
        return;
      }

      const updated = (insight.metrics ?? []).filter((m) => m.id !== metricId);
      updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight, insightVisualizations],
  );

  const handleAddMetric = useCallback(
    (metric: InsightMetric) => {
      const updated = [...(insight.metrics ?? []), metric];
      updateInsight(insight.id, { metrics: updated });
    },
    [insight.id, insight.metrics, updateInsight],
  );

  const handleEditMetric = useCallback(
    (updatedMetric: InsightMetric) => {
      const updated = (insight.metrics ?? []).map((m) =>
        m.id === updatedMetric.id ? updatedMetric : m,
      );
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
          onRenameClick={setFieldToRename}
          onAddClick={() => setIsFieldEditorOpen(true)}
        />

        {/* Metrics Section */}
        <MetricsSection
          metrics={visibleMetrics}
          onReorder={handleMetricsReorder}
          onRemove={handleRemoveMetric}
          onEditClick={setMetricToEdit}
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
        onSave={handleAddMetric}
      />
      <FieldRenameDialog
        field={fieldToRename}
        tableName={
          fieldToRename
            ? allDataTables.find((t) => t.id === fieldToRename.sourceTableId)
                ?.name
            : undefined
        }
        onOpenChange={(open) => !open && setFieldToRename(null)}
        onSave={handleRenameField}
      />
      <MetricEditDialog
        metric={metricToEdit}
        dataTable={dataTable}
        onOpenChange={(open) => !open && setMetricToEdit(null)}
        onSave={handleEditMetric}
      />
    </Panel>
  );
}
