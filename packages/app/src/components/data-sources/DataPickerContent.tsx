import { useHostMutation, requestHost } from "@/data/host";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { getConnectorById } from "@/lib/connectors/registry";
import { handleFileConnectorResult } from "@/lib/local-csv-handler";
import {
  connectRemoteSource,
  type RemoteResource,
  type SupportedRemoteConnectorId,
} from "@/lib/remote-connector-onboarding";
import { useConfirmDialogStore, type ConfirmDialogConfig } from "@/lib/stores";
import { api } from "@dashframe/convex-backend/api";
import type {
  FileSourceConnector,
  RemoteApiConnector,
  SourceType,
} from "@dashframe/engine";
import type { CreateDataSourceInput, UUID } from "@dashframe/types";
import { cmd, COMMAND_PATHS, resultValueByCommandPath } from "@dashframe/types";

import { Button, SectionList } from "@wystack/ui-react";
import { ArrowLeftIcon } from "@wystack/ui-react/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddConnectionPanel } from "./AddConnectionPanel";
import { DataSourceList, type DataSourceInfo } from "./DataSourceList";
import { DataTableList } from "./DataTableList";
import {
  RemoteImportUserError,
  RemoteResourceList,
  useRemoteResourceImport,
} from "./RemoteResourceImport";

const FILE_TABLE_NAME_EXTENSION = /\.(csv|xlsx?|json)$/i;

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
   * Called when a table is selected (existing or newly uploaded). Resolve
   * to `null` when the selection failed and the caller already reported it;
   * any other value, including `false` or `undefined`, counts as success.
   */
  onTableSelect: (
    tableId: string,
    tableName: string,
  ) => void | Promise<unknown>;
  /**
   * Exclude specific table IDs from selection
   */
  excludeTableIds?: string[];
  /**
   * Optional cancel button handler
   */
  onCancel?: () => void;
  /**
   * Whether to show existing data sources (the "Start from Raw Data" section
   * and its table drill-down). Set false for a connect-only dialog.
   * @default true
   */
  showSources?: boolean;
  /**
   * Only offer these kinds of connection under "Add New Data". A caller that
   * imports into one existing source passes its kind, so the picker cannot
   * create a different source and hand back a table from it.
   */
  connectorSourceTypes?: readonly SourceType[];
}

interface RemoteResourceState {
  connectorId: SupportedRemoteConnectorId;
  sourceId: UUID;
  resources: RemoteResource[];
}

/**
 * Reusable data picker content for selecting a table.
 *
 * Supports two selection modes:
 * 1. Raw Tables - from data sources (two-level hierarchy)
 * 2. New data upload - via connector pattern (CSV, Notion, etc.)
 *
 * Shared by several flows; find the consumers by its call sites.
 */
export function DataPickerContent({
  onTableSelect,
  excludeTableIds = [],
  onCancel,
  showSources = true,
  connectorSourceTypes,
}: DataPickerContentProps) {
  const dataSourcesQuery = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const { data: dataSources = [], isLoading: isLoadingDataSources } =
    dataSourcesQuery;
  const dataTablesQuery = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const { data: allDataTables = [], isLoading: isLoadingDataTables } =
    dataTablesQuery;
  const commitBatch = useMutation(api.app.commitBatch);
  const { mutateAsync: listNotionDatabasesMutation } = useHostMutation(
    "listNotionDatabases",
  );
  const { mutateAsync: listPostgresTablesMutation } =
    useHostMutation("listPostgresTables");
  const { mutateAsync: listGa4PropertiesMutation } =
    useHostMutation("listGa4Properties");
  const confirm = useConfirmDialogStore((state) => state.confirm);

  // Local state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteResourceState, setRemoteResourceState] =
    useState<RemoteResourceState | null>(null);
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

  const {
    importResource: handleRemoteResourceSelect,
    importingResourceId,
    error: remoteImportError,
    isImported: isRemoteResourceImported,
  } = useRemoteResourceImport({
    sourceId: remoteResourceState?.sourceId ?? null,
    onImported: async (tableId, resource) => {
      const selection = await onTableSelect(tableId, resource.title);
      if (selection === null) {
        throw new RemoteImportUserError(
          "Couldn't open the imported table. Try again.",
        );
      }
    },
  });

  const excludedRemoteResourceIds = useMemo(
    () =>
      new Set(
        allDataTables
          .filter((table) => excludeTableIds.includes(table.id))
          .map((table) => table.table),
      ),
    [allDataTables, excludeTableIds],
  );
  const importedRemoteResourceIds = useMemo(
    () =>
      new Set(
        allDataTables
          .filter(
            (table) => table.dataSourceId === remoteResourceState?.sourceId,
          )
          .map((table) => table.table),
      ),
    [allDataTables, remoteResourceState?.sourceId],
  );
  const selectableRemoteResources = useMemo(
    () =>
      (remoteResourceState?.resources ?? []).filter(
        (resource) =>
          !excludedRemoteResourceIds.has(resource.id) &&
          !importedRemoteResourceIds.has(resource.id) &&
          !isRemoteResourceImported(resource.id),
      ),
    [
      excludedRemoteResourceIds,
      importedRemoteResourceIds,
      isRemoteResourceImported,
      remoteResourceState,
    ],
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
        // The callback's void contract makes `undefined` a success; `null`
        // explicitly means the caller caught a creation failure.
        const selection = await onTableSelect(dataTableId, tableName);
        if (selection === null) {
          throw new Error("Couldn't open the imported table. Try again.");
        }
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
            const batch = await requestHost("commitBatch", { commands });
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
            await commitBatch({
              commands: [cmd("DeleteNode", { id })],
            });
          },
          listNotionDatabases: (id) =>
            listNotionDatabasesMutation({ dataSourceId: id }),
          listPostgresTables: (id) =>
            listPostgresTablesMutation({ dataSourceId: id }),
        }),
      );
    },
    [commitBatch, listNotionDatabasesMutation, listPostgresTablesMutation],
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

  const hasDataSources = dataSourcesInfo.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-2">
        {/* Section: Data Sources (Level 1) */}
        {!selectedSourceId && showSources && hasDataSources && (
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
              sourceTypes={connectorSourceTypes}
            />
          </SectionList>
        )}

        {remoteResourceState && !selectedSourceId && (
          <>
            <Button
              label="Choose another connection"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRemoteResourceState(null);
              }}
              icon={ArrowLeftIcon}
            />
            <SectionList title="Choose data to import">
              <RemoteResourceList
                resources={selectableRemoteResources}
                importingResourceId={importingResourceId}
                onSelect={handleRemoteResourceSelect}
                error={remoteImportError}
                emptyMessage="The connection succeeded, but no databases or tables were found."
              />
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
