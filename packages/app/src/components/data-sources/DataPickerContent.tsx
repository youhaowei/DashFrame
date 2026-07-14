import { getConnectorById } from "@/lib/connectors/registry";
import { handleFileConnectorResult } from "@/lib/local-csv-handler";
import {
  connectRemoteSource,
  type RemoteResource,
  type SupportedRemoteConnectorId,
} from "@/lib/remote-connector-onboarding";
import { materializeRemoteTable } from "@/lib/remote-table-materialization";
import {
  useDataFrames,
  useDataSourceMutations,
  useDataSources,
  useDataTableMutations,
  useDataTables,
  useInsights,
  useNotionMutations,
  usePostgresMutations,
} from "@dashframe/core";
import type {
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";
import type { UUID } from "@dashframe/types";
import { Button, SectionList } from "@wystack/ui";
import { ArrowLeftIcon } from "@wystack/ui-icons";
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
   * @default true
   */
  showNotion?: boolean;
  /**
   * Whether to show Postgres connection option
   * @default true
   */
  showPostgres?: boolean;
  /**
   * Whether to show insights section (requires onInsightSelect to be provided)
   * @default true
   */
  showInsights?: boolean;
}

interface RemoteResourceState {
  connectorId: SupportedRemoteConnectorId;
  sourceId: UUID;
  resources: RemoteResource[];
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
  showNotion = true,
  showPostgres = true,
  showInsights = true,
}: DataPickerContentProps) {
  const { data: dataSources = [] } = useDataSources();
  const { data: allDataTables = [] } = useDataTables();
  const { data: allInsights = [] } = useInsights();
  const { data: dataFrames = [] } = useDataFrames();
  const dataSourceMutations = useDataSourceMutations();
  const tableMutations = useDataTableMutations();
  const notionMutations = useNotionMutations();
  const postgresMutations = usePostgresMutations();

  // Local state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteResourceState, setRemoteResourceState] =
    useState<RemoteResourceState | null>(null);
  const [materializingResourceId, setMaterializingResourceId] = useState<
    string | null
  >(null);

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
        isLocal: getConnectorById(source?.type ?? "")?.sourceType === "file",
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

  const handleConnect = useCallback(
    async (
      connector: RemoteApiConnector,
      credentials: Record<string, unknown>,
    ) => {
      if (connector.id !== "notion" && connector.id !== "postgres") {
        throw new Error(`${connector.name} onboarding is not supported yet`);
      }

      setError(null);
      setRemoteResourceState(
        await connectRemoteSource({
          connectorId: connector.id,
          connectorName: connector.name,
          credentials,
          addSource: dataSourceMutations.add,
          removeSource: dataSourceMutations.remove,
          listNotionDatabases: notionMutations.listDatabases,
          listPostgresTables: postgresMutations.listTables,
        }),
      );
    },
    [dataSourceMutations, notionMutations, postgresMutations],
  );

  const handleRemoteResourceSelect = useCallback(
    async (resource: { id: string; title: string }) => {
      if (!remoteResourceState) return;
      setMaterializingResourceId(resource.id);
      setError(null);
      let tableId: UUID | null = null;
      try {
        tableId = await tableMutations.add(
          remoteResourceState.sourceId,
          resource.title,
          resource.id,
        );
        const result =
          remoteResourceState.connectorId === "notion"
            ? await notionMutations.queryDatabase(
                remoteResourceState.sourceId,
                resource.id,
                tableId,
              )
            : await postgresMutations.queryTable(
                remoteResourceState.sourceId,
                resource.id,
                tableId,
              );
        await materializeRemoteTable({ id: tableId }, result, resource.title);
        onTableSelect(tableId, resource.title);
      } catch (cause) {
        if (tableId) await tableMutations.remove(tableId).catch(() => {});
        setError(
          cause instanceof Error
            ? cause.message
            : "Failed to import remote table",
        );
      } finally {
        setMaterializingResourceId(null);
      }
    },
    [
      notionMutations,
      onTableSelect,
      postgresMutations,
      remoteResourceState,
      tableMutations,
    ],
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
              variant="ghost"
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
        {!selectedSourceId && !remoteResourceState && (
          <SectionList title="Add New Data">
            <AddConnectionPanel
              error={error}
              onFileSelect={handleFileSelect}
              onConnect={handleConnect}
              showNotion={showNotion}
              showPostgres={showPostgres}
            />
          </SectionList>
        )}

        {remoteResourceState && !selectedSourceId && (
          <>
            <Button
              label="Choose another connection"
              variant="ghost"
              size="sm"
              onClick={() => setRemoteResourceState(null)}
              icon={ArrowLeftIcon}
            />
            <SectionList title="Choose data to import">
              <div className="space-y-2">
                {remoteResourceState.resources.length === 0 ? (
                  <p className="text-sm text-neutral-fg-subtle">
                    The connection succeeded, but no databases or tables were
                    found.
                  </p>
                ) : (
                  remoteResourceState.resources.map((resource) => (
                    <Button
                      key={resource.id}
                      label={resource.title}
                      variant="outline"
                      className="w-full justify-start"
                      disabled={materializingResourceId !== null}
                      onClick={() => handleRemoteResourceSelect(resource)}
                    />
                  ))
                )}
              </div>
            </SectionList>
          </>
        )}
      </div>

      {/* Footer */}
      {onCancel && (
        <div className="flex justify-end">
          <Button label="Cancel" variant="outline" onClick={onCancel} />
        </div>
      )}
    </div>
  );
}
