"use client";

import { handleFileConnectorResult } from "@/lib/local-csv-handler";
import {
  useDataFrames,
  useDataSources,
  useDataTables,
  useInsights,
} from "@dashframe/core";
import type {
  FileSourceConnector,
  RemoteApiConnector,
  RemoteDatabase,
} from "@dashframe/engine";
import { ArrowLeftIcon, Button, SectionList } from "@dashframe/ui";
import { useCallback, useMemo, useState } from "react";
import { AddConnectionPanel } from "./AddConnectionPanel";
import { DataSourceList, type DataSourceInfo } from "./DataSourceList";
import { DataTableList } from "./DataTableList";
import { InsightList, type InsightDisplayInfo } from "./InsightList";

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
  // Dexie hooks
  const { data: dataSources = [] } = useDataSources();
  const { data: allDataTables = [] } = useDataTables();
  const { data: allInsights = [] } = useInsights();
  const { data: dataFrames = [] } = useDataFrames();

  // Local state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Transform sources for DataSourceList
  const dataSourcesInfo: DataSourceInfo[] = useMemo(() => {
    return dataSources.map((source) => {
      const tableCount = allDataTables.filter(
        (t) => t.dataSourceId === source.id,
      ).length;
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        tableCount,
      };
    });
  }, [dataSources, allDataTables]);

  // Filter tables by selected source and exclusions
  const filteredTables = useMemo(() => {
    let tables = allDataTables;

    // Filter by selected source
    if (selectedSourceId) {
      tables = tables.filter((t) => t.dataSourceId === selectedSourceId);
    }

    // Filter out excluded
    tables = tables.filter((t) => !excludeTableIds.includes(t.id));

    // Transform to expected format for DataTableList
    return tables.map((t) => {
      const source = dataSources.find((ds) => ds.id === t.dataSourceId);
      return {
        sourceId: t.dataSourceId,
        sourceName: source?.name || "Unknown",
        tableId: t.id,
        tableName: t.name,
        fieldCount: t.fields?.length || 0,
        isLocal: source?.type === "csv",
      };
    });
  }, [allDataTables, selectedSourceId, excludeTableIds, dataSources]);

  // Build DataFrame lookup by insight ID
  const dataFrameByInsightId = useMemo(() => {
    return new Map(
      dataFrames.filter((df) => df.insightId).map((df) => [df.insightId!, df]),
    );
  }, [dataFrames]);

  // Filter and transform insights for display
  const insightsForDisplay: InsightDisplayInfo[] = useMemo(() => {
    return allInsights
      .filter((insight) => {
        // Exclude specified IDs
        if (excludeInsightIds.includes(insight.id)) return false;
        // Only show insights with computed data (have a DataFrame)
        return dataFrameByInsightId.has(insight.id);
      })
      .map((insight) => ({
        id: insight.id,
        name: insight.name,
        metricCount: insight.metrics?.length || 0,
        rowCount: dataFrameByInsightId.get(insight.id)?.rowCount,
      }));
  }, [allInsights, excludeInsightIds, dataFrameByInsightId]);

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
        if (
          connector.maxSizeMB &&
          file.size > connector.maxSizeMB * 1024 * 1024
        ) {
          throw new Error(`File size exceeds ${connector.maxSizeMB}MB limit.`);
        }

        // Check for duplicate table
        const existingTable = allDataTables.find(
          (table) =>
            table.name === file.name ||
            table.name === file.name.replace(/\.(csv|xlsx?)$/i, ""),
        );

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
    [onTableSelect, allDataTables],
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

  const hasInsights =
    showInsights && insightsForDisplay.length > 0 && onInsightSelect;
  const hasDataSources = dataSourcesInfo.length > 0;

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="space-y-6 overflow-y-auto pr-2">
        {/* Section: Existing Insights (only if they have DataFrames) */}
        {hasInsights && !selectedSourceId && (
          <SectionList title="Use Existing Insight">
            <InsightList
              insights={insightsForDisplay}
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
              label="Back"
              variant="text"
              size="sm"
              onClick={() => setSelectedSourceId(null)}
              icon={ArrowLeftIcon}
            />
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
          <Button label="Cancel" variant="outlined" onClick={onCancel} />
        </div>
      )}
    </div>
  );
}
