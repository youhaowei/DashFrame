"use client";

import { useState, useCallback, useMemo } from "react";
import { Button, SectionList, ArrowLeft } from "@dashframe/ui";
import type {
  FileSourceConnector,
  RemoteApiConnector,
  RemoteDatabase,
} from "@dashframe/engine";
import { useDataTables } from "@/hooks/useDataTables";
import { useInsights } from "@/hooks/useInsights";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { handleFileConnectorResult } from "@/lib/local-csv-handler";
import { DataSourceList, type DataSourceInfo } from "./DataSourceList";
import { DataTableList } from "./DataTableList";
import { InsightList } from "./InsightList";
import { AddConnectionPanel } from "./AddConnectionPanel";

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
 * 3. New data upload - via connector pattern (CSV, Notion, etc.)
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
  const [error, setError] = useState<string | null>(null);
  const { allDataTables } = useDataTables(localSources, selectedSourceId);
  const { insights } = useInsights({
    excludeIds: excludeInsightIds,
    withComputedDataOnly: true,
  });

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

  // Handle file selection from connectors (CSV, Excel, etc.)
  const handleFileSelect = useCallback(
    async (connector: FileSourceConnector, file: File) => {
      setError(null);
      try {
        // Check for duplicate table
        const localSource = useDataSourcesStore.getState().getLocal();
        const existingTable = localSource
          ? Array.from(localSource.dataTables?.values?.() ?? []).find(
              (table) =>
                table.table === file.name ||
                table.name === file.name.replace(/\.(csv|xlsx?)$/i, ""),
            )
          : null;

        if (existingTable) {
          const shouldOverride = window.confirm(
            `"${file.name}" already exists. Replace the existing table with this file?`,
          );
          if (!shouldOverride) {
            return;
          }
        }

        // Use the connector's parse method
        const tableId = existingTable?.id ?? crypto.randomUUID();
        const result = await connector.parse(file, tableId);

        // Store the data using the connector result handler
        const { dataTableId } = await handleFileConnectorResult(
          file.name,
          result,
          existingTable ? { overrideTableId: existingTable.id } : undefined,
        );

        const tableName = file.name.replace(/\.(csv|xlsx?)$/i, "");
        onTableSelect(dataTableId, tableName);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process file");
      }
    },
    [onTableSelect],
  );

  // Handle remote connector connection (Notion, Airtable, etc.)
  const handleConnect = useCallback(
    (connector: RemoteApiConnector, databases: RemoteDatabase[]) => {
      // For now, just log - full implementation requires database selection UI
      console.log(`Connected to ${connector.name}:`, databases);
      // NOTE: Show database selection UI, then call onTableSelect
    },
    [],
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
              <ArrowLeft className="mr-2 h-4 w-4" />
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

        {/* Section: Add New Source */}
        {!selectedSourceId && (
          <SectionList title="Add New Data">
            <AddConnectionPanel
              error={error}
              onFileSelect={handleFileSelect}
              onConnect={handleConnect}
              showNotion={showNotion}
            />
          </SectionList>
        )}
      </div>

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
