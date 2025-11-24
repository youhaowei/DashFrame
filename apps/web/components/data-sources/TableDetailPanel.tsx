"use client";

import { useState } from "react";
import type { DataTable } from "@/lib/stores/types";
import type { EnhancedDataFrame } from "@dashframe/dataframe";
import { Button, Plus, Edit3, X, Sparkles, Layers, Panel, Toggle, EmptyState, cn } from "@dashframe/ui";
import { TableView } from "@/components/visualizations/TableView";

interface TableDetailPanelProps {
  dataTable: DataTable | null;
  dataFrame: EnhancedDataFrame | null;
  onCreateVisualization: () => void;
  onEditField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onAddField: () => void;
  onAddMetric: () => void;
  onDeleteMetric: (metricId: string) => void;
}

export function TableDetailPanel({
  dataTable,
  dataFrame,
  onCreateVisualization,
  onEditField,
  onDeleteField,
  onAddField,
  onAddMetric,
  onDeleteMetric,
}: TableDetailPanelProps) {
  const [activeTab, setActiveTab] = useState("fields");

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
                {dataFrame
                  ? `${dataFrame.metadata.rowCount} rows × ${dataFrame.metadata.columnCount} columns`
                  : "No data available"}
              </p>
            </div>
            <Button onClick={onCreateVisualization} size="sm" className="shrink-0">
              <Sparkles className="mr-2 h-4 w-4" />
              Create Visualization
            </Button>
          </div>

          <div className="border-border/60 mt-4 border-t pt-4">
            <Toggle
              variant="default"
              value={activeTab}
              onValueChange={setActiveTab}
              options={[
                { value: "fields", label: "Fields", badge: dataTable.fields.length },
                { value: "metrics", label: "Metrics", badge: dataTable.metrics.length },
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
            <Button variant="outline" size="sm" onClick={onAddField}>
              <Plus className="mr-2 h-4 w-4" />
              Add Field
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dataTable.fields.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground text-sm">No fields defined</p>
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
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEditField(field.id)}
                      className="h-8 w-8"
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDeleteField(field.id)}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 w-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
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
            <Button variant="outline" size="sm" onClick={onAddMetric}>
              <Plus className="mr-2 h-4 w-4" />
              Add Metric
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dataTable.metrics.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground text-sm">No metrics defined</p>
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
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDeleteMetric(metric.id)}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 w-8 shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
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
          <p className="text-muted-foreground text-sm">
            {dataFrame
              ? `Showing first ${Math.min(50, dataFrame.metadata.rowCount)} rows`
              : "No data available"}
          </p>

          <div className="border-border/60 min-h-0 flex-1 overflow-hidden rounded-xl border">
            {dataFrame ? (
              <TableView dataFrame={dataFrame.data} fields={dataTable.fields} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground text-sm">
                  No data preview available
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
