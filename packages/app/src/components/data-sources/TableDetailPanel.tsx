import { useDataFrameData } from "@/hooks/useDataFrameData";
import type { DataFrameEntry } from "@dashframe/core";
import type { DataTable, FieldSensitivity } from "@dashframe/types";
import {
  getFieldSensitivity,
  suggestSensitivityFromName,
} from "@dashframe/types";
import { VirtualTable } from "@dashframe/ui";
import {
  CloseIcon,
  DeleteIcon,
  EditIcon,
  LayersIcon,
  PlusIcon,
  SparklesIcon,
} from "@stdui/icons";
import { Button, ButtonGroup, EmptyState, Panel, Toggle } from "@stdui/react";
import { useState } from "react";

interface TableDetailPanelProps {
  dataTable: DataTable | null;
  dataFrameEntry: DataFrameEntry | null;
  onCreateVisualization: () => void;
  onEditField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  /**
   * One-click sensitivity marking. `reasons` carries classifier suggestions
   * when the user confirms one (keeps the marking legible).
   */
  onSetFieldSensitivity: (
    fieldId: string,
    sensitivity: FieldSensitivity,
    reasons?: string[],
  ) => void;
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
  onSetFieldSensitivity,
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
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent bg-neutral-bg-muted" />
            <p className="text-sm text-neutral-fg-subtle">Loading data...</p>
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
        <p className="text-sm text-neutral-fg-subtle">
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
          icon={LayersIcon}
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
              <h1 className="text-xl font-semibold text-neutral-fg">
                {dataTable.name}
              </h1>
              <p className="mt-1 text-sm text-neutral-fg-subtle">
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
                  icon: DeleteIcon,
                  variant: "ghost",
                  className:
                    "text-palette-danger hover:bg-palette-danger hover:text-palette-danger-fg",
                },
                {
                  label: "Create Visualization",
                  onClick: onCreateVisualization,
                  icon: SparklesIcon,
                },
              ]}
            />
          </div>

          <div className="mt-4 border-t border-neutral-border/60 pt-4">
            <Toggle
              variant="soft"
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
            <p className="text-sm text-neutral-fg-subtle">
              {dataTable.fields.length} field
              {dataTable.fields.length !== 1 ? "s" : ""}
            </p>
            <Button
              label="Add Field"
              variant="outline"
              size="sm"
              onClick={onAddField}
              icon={PlusIcon}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dataTable.fields.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-neutral-fg-subtle">
                  No fields defined
                </p>
              </div>
            ) : (
              dataTable.fields.map((field) => {
                const sensitivity = getFieldSensitivity(field);
                const suggestedReasons =
                  sensitivity === "unclassified"
                    ? suggestSensitivityFromName(field.name)
                    : [];

                return (
                  <div
                    key={field.id}
                    className="flex items-center justify-between rounded-xl border border-neutral-border/60 p-3 transition-colors hover:border-neutral-border"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="truncate text-sm font-medium text-neutral-fg">
                        {field.name}
                      </span>
                      <span className="shrink-0 rounded bg-neutral-bg-muted px-2 py-0.5 text-xs font-medium text-neutral-fg-subtle">
                        {field.type}
                      </span>
                      {sensitivity === "sensitive" && (
                        <span
                          title={field.sensitivityReason}
                          className="shrink-0 rounded bg-palette-danger/10 px-2 py-0.5 text-xs font-medium text-palette-danger"
                        >
                          Sensitive
                        </span>
                      )}
                      {sensitivity === "unclassified" &&
                        (suggestedReasons.length > 0 ? (
                          <button
                            type="button"
                            title={`${suggestedReasons.join("; ")} — click to confirm as sensitive`}
                            onClick={() =>
                              onSetFieldSensitivity(
                                field.id,
                                "sensitive",
                                suggestedReasons,
                              )
                            }
                            className="shrink-0 cursor-pointer rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 hover:bg-amber-100 dark:bg-amber-950 dark:hover:bg-amber-900"
                          >
                            Likely sensitive
                          </button>
                        ) : (
                          <span
                            title="Treated as sensitive until cleared"
                            className="shrink-0 rounded bg-neutral-bg-muted px-2 py-0.5 text-xs font-medium text-neutral-fg-subtle"
                          >
                            Unclassified
                          </span>
                        ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {sensitivity !== "cleared" && (
                        <Button
                          label="Mark safe"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            onSetFieldSensitivity(field.id, "cleared")
                          }
                          className="h-8"
                        />
                      )}
                      <Button
                        label="Edit field"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={() => onEditField(field.id)}
                        className="h-8 w-8"
                        icon={EditIcon}
                      />
                      <Button
                        label="Delete field"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={() => onDeleteField(field.id)}
                        className="h-8 w-8 text-palette-danger hover:bg-palette-danger hover:text-palette-danger-fg"
                        icon={CloseIcon}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Metrics Content */}
      {activeTab === "metrics" && (
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-fg-subtle">
              {dataTable.metrics.length} metric
              {dataTable.metrics.length !== 1 ? "s" : ""}
            </p>
            <Button
              label="Add Metric"
              variant="outline"
              size="sm"
              onClick={onAddMetric}
              icon={PlusIcon}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dataTable.metrics.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-neutral-fg-subtle">
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
                    className="flex items-center justify-between rounded-xl border border-neutral-border/60 p-3 transition-colors hover:border-neutral-border"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="truncate text-sm font-medium text-neutral-fg">
                        {metric.name}
                      </span>
                      <span className="shrink-0 rounded bg-neutral-bg-muted px-2 py-0.5 font-mono text-xs text-neutral-fg-subtle">
                        {formula}
                      </span>
                    </div>
                    <Button
                      label="Delete metric"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => onDeleteMetric(metric.id)}
                      className="h-8 w-8 shrink-0 text-palette-danger hover:bg-palette-danger hover:text-palette-danger-fg"
                      icon={CloseIcon}
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
          <p className="text-sm text-neutral-fg-subtle">{previewStatus}</p>

          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-neutral-border/60">
            {renderPreviewContent()}
          </div>
        </div>
      )}
    </Panel>
  );
}
