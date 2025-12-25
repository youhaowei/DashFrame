"use client";

import { useState } from "react";
import type { DataTable } from "@dashframe/types";
import type { DataFrameEntry } from "@dashframe/core";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import {
  Button,
  Plus,
  Edit3,
  X,
  Sparkles,
  Layers,
  Panel,
  Toggle,
  EmptyState,
  VirtualTable,
  Trash2,
  ButtonGroup,
} from "@dashframe/ui";

interface TableDetailPanelProps {
  dataTable: DataTable | null;
  dataFrameEntry: DataFrameEntry | null;
  onCreateVisualization: () => void;
  onEditField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onAddField: () => void;
  onAddMetric: () => void;
  onDeleteMetric: (metricId: string) => void;
  onDeleteTable: () => void;
}

export function TableDetailPanel({
  dataTable,
  dataFrameEntry,
  onCreateVisualization,
  onEditField,
  onDeleteField,
  onAddField,
  onAddMetric,
  onDeleteMetric,
  onDeleteTable,
}: TableDetailPanelProps) {
  const [activeTab, setActiveTab] = useState("fields");

  // Load data only when preview tab is active (lazy loading)
  const { data: previewData, isLoading: isLoadingPreview } = useDataFrameData(
    dataFrameEntry?.id,
    { limit: 50, skip: activeTab !== "preview" },
  );

  let previewStatus = "No data available";
  if (isLoadingPreview) {
    previewStatus = "Loading preview...";
  } else if (previewData) {
    const rowCount = Math.min(
      50,
      dataFrameEntry?.rowCount ?? previewData.rows.length,
    );
    previewStatus = `Showing first ${rowCount} rows`;
  }

  const renderPreviewContent = () => {
    if (isLoadingPreview) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="bg-muted h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <p className="text-muted-foreground text-sm">Loading data...</p>
          </div>
        </div>
      );
    }

    if (previewData) {
      return (
        <VirtualTable
          rows={previewData.rows}
          columns={previewData.columns}
          height="100%"
          className="flex-1"
        />
      );
    }

    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">
          No data preview available
        </p>
      </div>
    );
  };

  // Empty state when no table selected
  if (!dataTable) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Layers}
          title="Select a table to view details"
          description="Choose a table from the list to view and edit its fields, metrics, and data."
        />
      </div>
    );
  }

  return (
    <Panel
      header={
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-foreground text-xl font-semibold">
                {dataTable.name}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {dataFrameEntry
                  ? `${dataFrameEntry.rowCount ?? "?"} rows × ${dataFrameEntry.columnCount ?? "?"} columns`
                  : "No data available"}
              </p>
            </div>
            <ButtonGroup
              actions={[
                {
                  label: "Delete Table",
                  onClick: onDeleteTable,
                  icon: Trash2,
                  variant: "text",
                  className:
                    "text-destructive hover:bg-destructive hover:text-destructive-foreground",
                },
                {
                  label: "Create Visualization",
                  onClick: onCreateVisualization,
                  icon: Sparkles,
                },
              ]}
            />
          </div>

          <div className="border-border/60 mt-4 border-t pt-4">
            <Toggle
              variant="default"
              value={activeTab}
              onValueChange={setActiveTab}
              options={[
                {
                  value: "fields",
                  label: "Fields",
                  badge: dataTable.fields.length,
                },
                {
                  value: "metrics",
                  label: "Metrics",
                  badge: dataTable.metrics.length,
                },
                { value: "preview", label: "Preview" },
              ]}
            />
          </div>
        </div>
      }
    >
      {/* Fields Content */}
      {activeTab === "fields" && (
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              {dataTable.fields.length} field
              {dataTable.fields.length !== 1 ? "s" : ""}
            </p>
            <Button
              label="Add Field"
              variant="outlined"
              size="sm"
              onClick={onAddField}
              icon={Plus}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dataTable.fields.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground text-sm">
                  No fields defined
                </p>
              </div>
            ) : (
              dataTable.fields.map((field) => (
                <div
                  key={field.id}
                  className="border-border/60 hover:border-border flex items-center justify-between rounded-xl border p-3 transition-colors"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="text-foreground truncate text-sm font-medium">
                      {field.name}
                    </span>
                    <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 text-xs font-medium">
                      {field.type}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      label="Edit field"
                      variant="text"
                      size="sm"
                      iconOnly
                      onClick={() => onEditField(field.id)}
                      className="h-8 w-8"
                      icon={Edit3}
                    />
                    <Button
                      label="Delete field"
                      variant="text"
                      size="sm"
                      iconOnly
                      onClick={() => onDeleteField(field.id)}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 w-8"
                      icon={X}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Metrics Content */}
      {activeTab === "metrics" && (
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              {dataTable.metrics.length} metric
              {dataTable.metrics.length !== 1 ? "s" : ""}
            </p>
            <Button
              label="Add Metric"
              variant="outlined"
              size="sm"
              onClick={onAddMetric}
              icon={Plus}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dataTable.metrics.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground text-sm">
                  No metrics defined
                </p>
              </div>
            ) : (
              dataTable.metrics.map((metric) => {
                const formula = metric.columnName
                  ? `${metric.aggregation}(${metric.columnName})`
                  : `${metric.aggregation}()`;

                return (
                  <div
                    key={metric.id}
                    className="border-border/60 hover:border-border flex items-center justify-between rounded-xl border p-3 transition-colors"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="text-foreground truncate text-sm font-medium">
                        {metric.name}
                      </span>
                      <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 font-mono text-xs">
                        {formula}
                      </span>
                    </div>
                    <Button
                      label="Delete metric"
                      variant="text"
                      size="sm"
                      iconOnly
                      onClick={() => onDeleteMetric(metric.id)}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 w-8 shrink-0"
                      icon={X}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Preview Content */}
      {activeTab === "preview" && (
        <div className="flex h-full flex-col gap-4 p-4">
          <p className="text-muted-foreground text-sm">{previewStatus}</p>

          <div className="border-border/60 min-h-0 flex-1 overflow-hidden rounded-xl border">
            {renderPreviewContent()}
          </div>
        </div>
      )}
    </Panel>
  );
}
