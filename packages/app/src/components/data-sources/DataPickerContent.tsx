import { getConnectorById } from "@/lib/connectors/registry";
import { handleFileConnectorResult } from "@/lib/local-csv-handler";
import {
  connectRemoteSource,
  type RemoteResource,
  type SupportedRemoteConnectorId,
} from "@/lib/remote-connector-onboarding";
import {
  reviewUnclassifiedRemoteFields,
  type RemoteFieldReviewRequest,
} from "@/lib/remote-field-review";
import { useConfirmDialogStore, type ConfirmDialogConfig } from "@/lib/stores";
import { api } from "@/wystack/api";
import type {
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";
import type { CreateDataSourceInput, Field, UUID } from "@dashframe/types";
import {
  cmd,
  COMMAND_PATHS,
  getFieldSensitivity,
  resultValueByCommandPath,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { Button, SectionList } from "@wystack/ui-react";
import { ArrowLeftIcon } from "@wystack/ui-react/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddConnectionPanel } from "./AddConnectionPanel";
import { DataSourceList, type DataSourceInfo } from "./DataSourceList";
import { DataTableList } from "./DataTableList";
import { InsightList, type InsightDisplayInfo } from "./InsightList";

const FILE_TABLE_NAME_EXTENSION = /\.(csv|xlsx?|json)$/i;

function requestRemoteFieldReview(
  confirm: (config: ConfirmDialogConfig) => void,
  resourceTitle: string,
  { field, position, total }: RemoteFieldReviewRequest,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirm({
      title: `Review column ${position} of ${total}`,
      description: `DashFrame will store “${field.name}” from ${resourceTitle} locally. Confirm that this specific column contains no sensitive data.`,
      confirmLabel: "Clear this column",
      cancelLabel: "Cancel import",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function requestFileTableReplacement(
  confirm: (config: ConfirmDialogConfig) => void,
  {
    fileName,
    tableName,
    sourceName,
  }: {
    fileName: string;
    tableName: string;
    sourceName: string;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    confirm({
      title: `Replace table "${tableName}" from "${sourceName}"?`,
      description: `The existing file-backed table "${tableName}" from "${sourceName}" will be overwritten by "${fileName}". Renamed or removed columns can break Insights that reference them.`,
      confirmLabel: "Replace table",
      cancelLabel: "Cancel upload",
      variant: "destructive",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

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
  showInsights = true,
}: DataPickerContentProps) {
  const dataSourcesQuery = useQuery(api.listDataSources);
  const { data: dataSources = [], isLoading: isLoadingDataSources } =
    dataSourcesQuery;
  const dataTablesQuery = useQuery(api.listDataTables, { args: {} });
  const { data: allDataTables = [], isLoading: isLoadingDataTables } =
    dataTablesQuery;
  const { data: allInsights = [] } = useQuery(api.listInsights, { args: {} });
  const { data: dataFrames = [] } = useQuery(api.listDataFrames);
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);
  const { mutateAsync: removeDataSource } = useMutation(api.removeDataSource);
  const { mutateAsync: addDataTable } = useMutation(api.addDataTable);
  const { mutateAsync: removeDataTable } = useMutation(api.removeDataTable);
  const { mutateAsync: listNotionDatabasesMutation } = useMutation(
    api.listNotionDatabases,
  );
  const { mutateAsync: queryNotionDatabaseMutation } = useMutation(
    api.queryNotionDatabase,
  );
  const { mutateAsync: listPostgresTablesMutation } = useMutation(
    api.listPostgresTables,
  );
  const { mutateAsync: queryPostgresTableMutation } = useMutation(
    api.queryPostgresTable,
  );
  const { mutateAsync: listGa4PropertiesMutation } = useMutation(
    api.listGa4Properties,
  );
  const { mutateAsync: queryGa4PropertyMutation } = useMutation(
    api.queryGa4Property,
  );
  const confirm = useConfirmDialogStore((state) => state.confirm);

  // Local state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteResourceState, setRemoteResourceState] =
    useState<RemoteResourceState | null>(null);
  const [importingResourceId, setImportingResourceId] = useState<string | null>(
    null,
  );
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const excludedRemoteResourceIds = useMemo(
    () =>
      new Set(
        allDataTables
          .filter((table) => excludeTableIds.includes(table.id))
          .map((table) => table.table),
      ),
    [allDataTables, excludeTableIds],
  );
  const selectableRemoteResources = useMemo(
    () =>
      (remoteResourceState?.resources ?? []).filter(
        (resource) => !excludedRemoteResourceIds.has(resource.id),
      ),
    [excludedRemoteResourceIds, remoteResourceState],
  );

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
      if (isLoadingDataSources) {
        setError("Data sources are still loading — try again in a moment.");
        return;
      }
      if (dataSourcesQuery.isError) {
        setError("Data sources could not be loaded — try again in a moment.");
        return;
      }
      if (isLoadingDataTables) {
        setError("Data tables are still loading — try again in a moment.");
        return;
      }
      if (dataTablesQuery.isError) {
        setError("Data tables could not be loaded — try again in a moment.");
        return;
      }
      try {
        if (
          connector.maxSizeMB &&
          file.size > connector.maxSizeMB * 1024 * 1024
        ) {
          throw new Error(`File size exceeds ${connector.maxSizeMB}MB limit.`);
        }

        // Only file-backed tables can be replaced by an uploaded file. A
        // remote table with the same name is a separate source of truth and
        // must never be used as an overwrite target.
        const existingTable = allDataTables.find((table) => {
          const source = dataSources.find(
            (dataSource) => dataSource.id === table.dataSourceId,
          );
          const isFileBacked =
            getConnectorById(source?.type ?? "")?.sourceType === "file";
          return (
            isFileBacked &&
            !excludeTableIds.includes(table.id) &&
            (table.name === file.name ||
              table.name === file.name.replace(FILE_TABLE_NAME_EXTENSION, ""))
          );
        });

        if (existingTable) {
          const source = dataSources.find(
            (dataSource) => dataSource.id === existingTable.dataSourceId,
          );
          const sourceName =
            source?.name ??
            getConnectorById(source?.type ?? "")?.name ??
            source?.type ??
            "file source";
          const shouldOverride = await requestFileTableReplacement(confirm, {
            fileName: file.name,
            tableName: existingTable.name,
            sourceName,
          });
          if (!shouldOverride) {
            return;
          }
          if (!isMountedRef.current) {
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
          { overrideTableId: tableId },
        );

        const tableName = file.name.replace(FILE_TABLE_NAME_EXTENSION, "");
        onTableSelect(dataTableId, tableName);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process file");
      }
    },
    [
      onTableSelect,
      allDataTables,
      dataSources,
      dataTablesQuery.isError,
      dataSourcesQuery.isError,
      isLoadingDataTables,
      isLoadingDataSources,
      confirm,
      excludeTableIds,
    ],
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
          addSource: async (input: CreateDataSourceInput) => {
            const id = crypto.randomUUID() as UUID;
            const commands = [
              cmd("CreateDataSource", {
                id,
                type: input.type,
                name: input.name,
                apiKey: input.apiKey,
                connectionString: input.connectionString,
              }),
            ];
            // defaultSchema is non-credential connector config — follow with
            // SetDataSourceConfig.extra in the same batch when present.
            if (input.config?.defaultSchema !== undefined) {
              commands.push(
                cmd("SetDataSourceConfig", {
                  id,
                  extra: { defaultSchema: input.config.defaultSchema },
                }),
              );
            }
            const batch = await commitBatch({ commands });
            const created = resultValueByCommandPath(
              batch,
              COMMAND_PATHS.CreateDataSource,
            ) as { id: string } | undefined;
            if (!created?.id) {
              throw new Error("CreateDataSource did not return an id");
            }
            return created.id as UUID;
          },
          removeSource: async (id) => {
            await removeDataSource({ id });
          },
          listNotionDatabases: (id) =>
            listNotionDatabasesMutation({ dataSourceId: id }),
          listPostgresTables: (id) =>
            listPostgresTablesMutation({ dataSourceId: id }),
        }),
      );
    },
    [
      commitBatch,
      listNotionDatabasesMutation,
      listPostgresTablesMutation,
      removeDataSource,
    ],
  );

  const handleOAuthConnect = useCallback(
    async (connector: RemoteApiConnector, dataSourceId: string) => {
      if (connector.id !== "googleAnalytics") {
        throw new Error(`${connector.name} OAuth onboarding is not supported`);
      }
      setError(null);
      setRemoteResourceState({
        connectorId: "googleAnalytics",
        sourceId: dataSourceId,
        resources: await listGa4PropertiesMutation({ dataSourceId }),
      });
    },
    [listGa4PropertiesMutation],
  );

  const handleRemoteResourceSelect = useCallback(
    async (resource: { id: string; title: string }) => {
      if (!remoteResourceState) return;
      setImportingResourceId(resource.id);
      setError(null);
      let tableId: UUID | null = null;
      try {
        tableId = (
          await addDataTable({
            dataSourceId: remoteResourceState.sourceId,
            name: resource.title,
            table: resource.id,
          })
        ).id;
        const queryResource = (snapshot = false, approvedFields?: Field[]) => {
          const snapshotRequest = snapshot
            ? { snapshot: true, approvedFields }
            : {};
          if (remoteResourceState.connectorId === "notion") {
            return queryNotionDatabaseMutation({
              dataSourceId: remoteResourceState.sourceId,
              databaseId: resource.id,
              tableId: tableId!,
              ...snapshotRequest,
            });
          }
          if (remoteResourceState.connectorId === "postgres") {
            return queryPostgresTableMutation({
              dataSourceId: remoteResourceState.sourceId,
              databaseId: resource.id,
              tableId: tableId!,
              ...snapshotRequest,
            });
          }
          // The property is read from the DataTable row just created above,
          // so it cannot drift from the resource the user picked.
          return queryGa4PropertyMutation({
            dataSourceId: remoteResourceState.sourceId,
            tableId: tableId!,
            ...snapshotRequest,
          });
        };
        const result = await queryResource();
        const explicitlySensitive = result.fields.some(
          (field) => getFieldSensitivity(field) === "sensitive",
        );
        if (explicitlySensitive) {
          throw new Error("Sensitive remote columns cannot be cached locally");
        }

        const reviewedFields = await reviewUnclassifiedRemoteFields(
          result.fields,
          (request) =>
            requestRemoteFieldReview(confirm, resource.title, request),
        );
        if (!reviewedFields) {
          await removeDataTable({ id: tableId });
          tableId = null;
          return;
        }

        await queryResource(true, reviewedFields);
        onTableSelect(tableId, resource.title);
      } catch {
        const cleanupResults = await Promise.allSettled([
          ...(tableId ? [removeDataTable({ id: tableId })] : []),
        ]);
        const cleanupFailed = cleanupResults.some(
          ({ status }) => status === "rejected",
        );
        setError(
          cleanupFailed
            ? "The import failed and cleanup could not finish. Remove the partial table from Data Sources before retrying."
            : "Couldn't import this table. Check the connection and try again.",
        );
      } finally {
        setImportingResourceId(null);
      }
    },
    [
      queryNotionDatabaseMutation,
      addDataTable,
      onTableSelect,
      queryPostgresTableMutation,
      queryGa4PropertyMutation,
      confirm,
      remoteResourceState,
      removeDataTable,
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
              onOAuthConnect={handleOAuthConnect}
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
                {error && (
                  <p role="alert" className="text-sm text-danger-fg">
                    {error}
                  </p>
                )}
                {selectableRemoteResources.length === 0 ? (
                  <p className="text-sm text-neutral-fg-subtle">
                    The connection succeeded, but no databases or tables were
                    found.
                  </p>
                ) : (
                  selectableRemoteResources.map((resource) => (
                    <Button
                      key={resource.id}
                      label={resource.title}
                      variant="outline"
                      className="w-full justify-start"
                      disabled={importingResourceId !== null}
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
