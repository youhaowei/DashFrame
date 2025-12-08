"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Button,
  Alert,
  AlertDescription,
  SectionList,
  Database,
} from "@dashframe/ui";
import { LuArrowLeft } from "react-icons/lu";
import { useDataTables } from "@/hooks/useDataTables";
import { useCSVUpload } from "@/hooks/useCSVUpload";
import { useInsights } from "@/hooks/useInsights";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { DataSourceList, type DataSourceInfo } from "./DataSourceList";
import { DataTableList } from "./DataTableList";
import { InsightList } from "./InsightList";
import { AddConnectionPanel } from "./AddConnectionPanel";
import { useNotionConnection } from "@/hooks/useNotionConnection";


export interface DataPickerContentProps {
  /**
   * Called when an existing insight is selected.
   * If not provided, the insights section is hidden.
   */
  onInsightSelect?: (insightId: string, insightName: string) => void;
  /**
   * Called when a table is selected (existing or newly uploaded)
   */
  onTableSelect: (tableId: string, tableName: string) => void;
  /**
   * Exclude specific insight IDs from selection
   */
  excludeInsightIds?: string[];
  /**
   * Exclude specific table IDs from selection
   */
  excludeTableIds?: string[];
  /**
   * Optional cancel button handler
   */
  onCancel?: () => void;
  /**
   * Whether to show Notion connection option
   * @default false
   */
  showNotion?: boolean;
  /**
   * Whether to show insights section (requires onInsightSelect to be provided)
   * @default true
   */
  showInsights?: boolean;
}

/**
 * Reusable data picker content for selecting insights or tables.
 *
 * Supports three selection modes:
 * 1. Existing Insights - insights with computed DataFrames for chaining
 * 2. Raw Tables - from data sources (two-level hierarchy)
 * 3. New CSV upload - creates table and triggers selection
 *
 * Used by both CreateVisualizationModal and JoinFlowModal.
 *
 * @example Basic usage (tables only)
 * ```tsx
 * <DataPickerContent
 *   onTableSelect={(tableId, tableName) => {
 *     createInsightFromTable(tableId, tableName);
 *   }}
 * />
 * ```
 *
 * @example With insights (for chaining)
 * ```tsx
 * <DataPickerContent
 *   onInsightSelect={(insightId, name) => handleInsightSelect(insightId)}
 *   onTableSelect={handleTableSelect}
 *   excludeInsightIds={[currentInsightId]}
 * />
 * ```
 */
export function DataPickerContent({
  onInsightSelect,
  onTableSelect,
  excludeInsightIds = [],
  excludeTableIds = [],
  onCancel,
  showNotion = false,
  showInsights = true,
}: DataPickerContentProps) {
  const localSources = useDataSourcesStore((state) => state.getAll());
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const { allDataTables } = useDataTables(localSources, selectedSourceId);
  const { handleCSVUpload, error: csvError, clearError } = useCSVUpload();
  const { insights } = useInsights({
    excludeIds: excludeInsightIds,
    withComputedDataOnly: true,
  });

  // Notion connection (internal)
  const {
    apiKey: notionApiKey,
    showApiKey: showNotionApiKey,
    setApiKey: setNotionApiKey,
    toggleShowApiKey: toggleShowNotionApiKey,
    connect: connectNotion,
    isLoading: isNotionLoading,
    error: notionError,
  } = useNotionConnection();

  // Transform sources for DataSourceList
  const dataSourcesInfo: DataSourceInfo[] = useMemo(
    () =>
      localSources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        tableCount: source.dataTables?.size || 0,
      })),
    [localSources],
  );

  // Filter out excluded tables
  const filteredTables = useMemo(
    () =>
      allDataTables.filter((table) => !excludeTableIds.includes(table.tableId)),
    [allDataTables, excludeTableIds],
  );

  // Handle insight click
  const handleInsightClick = useCallback(
    (insightId: string, insightName: string) => {
      onInsightSelect?.(insightId, insightName);
    },
    [onInsightSelect],
  );

  // Handle table click
  const handleTableClick = useCallback(
    (tableId: string, tableName: string) => {
      onTableSelect(tableId, tableName);
    },
    [onTableSelect],
  );

  // Handle CSV upload
  const handleCSVSelect = useCallback(
    (file: File) => {
      clearError();
      handleCSVUpload(file, (dataTableId) => {
        const tableName = file.name.replace(/\.csv$/i, "");
        onTableSelect(dataTableId, tableName);
      });
    },
    [handleCSVUpload, clearError, onTableSelect],
  );

  const hasInsights = showInsights && insights.length > 0 && onInsightSelect;
  const hasDataSources = dataSourcesInfo.length > 0;

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="space-y-6 overflow-y-auto pr-2">
        {/* Section: Existing Insights (only if they have DataFrames) */}
        {hasInsights && !selectedSourceId && (
          <SectionList title="Use Existing Insight">
            <InsightList
              insights={insights}
              onInsightClick={handleInsightClick}
            />
          </SectionList>
        )}

        {/* Section: Data Sources (Level 1) */}
        {!selectedSourceId && hasDataSources && (
          <SectionList title="Start from Raw Data">
            <DataSourceList
              sources={dataSourcesInfo}
              onSourceClick={setSelectedSourceId}
            />
          </SectionList>
        )}

        {/* Section: Tables within selected source (Level 2) */}
        {selectedSourceId && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedSourceId(null)}
            >
              <LuArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <SectionList title="Select Table">
              <DataTableList
                tables={filteredTables}
                onTableClick={handleTableClick}
              />
            </SectionList>
          </>
        )}

        {/* Empty state when nothing exists */}
        {!selectedSourceId && !hasDataSources && !hasInsights && (
          <div className="rounded-xl border border-dashed py-8 text-center">
            <Database className="text-muted-foreground mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">No data yet</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Upload a CSV file below to get started
            </p>
          </div>
        )}

        {/* Section: Add New Source */}
        {!selectedSourceId && (
          <SectionList title="Add New Data">
            <AddConnectionPanel
              onCsvSelect={handleCSVSelect}
              csvDescription="Upload a CSV file with headers in the first row."
              csvHelperText="Supports .csv files up to 5MB"
              notion={
                showNotion
                  ? {
                    apiKey: notionApiKey,
                    showApiKey: showNotionApiKey,
                    onApiKeyChange: setNotionApiKey,
                    onToggleShowApiKey: toggleShowNotionApiKey,
                    onConnectNotion: connectNotion,
                    connectButtonLabel: isNotionLoading
                      ? "Connecting..."
                      : "Connect Notion",
                    connectDisabled: !notionApiKey || isNotionLoading,
                  }
                  : undefined
              }
            />
          </SectionList>
        )}
      </div>

      {/* Errors */}
      {(csvError || notionError) && (
        <Alert variant="destructive">
          <AlertDescription>
            {csvError && <div className="mb-1">{csvError}</div>}
            {notionError && <div>{notionError}</div>}
          </AlertDescription>
        </Alert>
      )}

      {/* Footer */}
      {onCancel && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
