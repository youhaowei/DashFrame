import { useDataFrameData } from "@/hooks/useDataFrameData";
import {
  addDataFrameEntry,
  getDataTable,
  replaceDataFrame,
  updateDataTable,
  useDataSources,
  useDataTables,
  useNotionMutations,
} from "@dashframe/core";
import { DataFrame } from "@dashframe/engine-browser";
import type { DataTable, Field, UUID } from "@dashframe/types";
import { VirtualTable, type VirtualTableColumn } from "@dashframe/ui";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Surface,
} from "@wystack/ui";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DatabaseIcon,
  LayersIcon,
  RefreshIcon,
} from "@wystack/ui-icons";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

interface DataSourceDisplayProps {
  dataSourceId: string | null;
}

// Preview data type for Notion sources.
// rowCount is the actual fetched row count; undefined when only column schema
// is available (e.g. the serializable query result carries no materialized rows).
// tableId keys the preview to the data table it was synced from — stale preview
// from a previously selected table is suppressed by comparing to selectedDataTable.id.
interface PreviewData {
  tableId: string;
  rows: Record<string, unknown>[];
  columns: VirtualTableColumn[];
  rowCount?: number;
}

// External-clock store: ticks once a minute on the client so relative-time
// strings stay fresh without calling Date.now() during render.
const subscribeNow = (notify: () => void) => {
  const id = setInterval(notify, 60_000);
  return () => clearInterval(id);
};
const getNowSnapshot = () => Date.now();
const getNowServerSnapshot = () => 0;

// Pure relative-time formatter — extracted so its branch-chain doesn't count
// toward DataSourceDisplay's cognitive complexity.
function formatRelativeTime(now: number, timestamp: number): string {
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

// Helper to get preview description text
function getPreviewDescription(
  selectedDataTable: { name: string; lastFetchedAt?: number } | null,
  previewData: PreviewData | null,
  formatRelativeTime: (ts: number) => string,
): React.ReactNode {
  if (!selectedDataTable) {
    return "Select a table to preview data";
  }
  if (!previewData) {
    return `No data available for ${JSON.stringify(selectedDataTable.name)}`;
  }
  const countLabel =
    previewData.rowCount !== undefined
      ? `${previewData.rowCount} rows`
      : `${previewData.columns.length} columns`;
  return (
    <>
      Showing data from {JSON.stringify(selectedDataTable.name)} • {countLabel}
      {selectedDataTable.lastFetchedAt && (
        <>
          {" "}
          • Last fetched: {formatRelativeTime(selectedDataTable.lastFetchedAt)}
        </>
      )}
    </>
  );
}

// Helper to get files description text
function getFilesDescription(fileCount: number): string {
  if (fileCount === 0) return "No files uploaded";
  const label = fileCount === 1 ? "file" : "files";
  return `${fileCount} ${label} available`;
}

// Helper to get table stats description.
// rowCount may be undefined when only the column schema has been fetched
// (the serializable query result carries no materialized row count).
function getTableStatsDescription(
  rowCount: number | undefined,
  columnCount: number | undefined,
  lastFetchedAt: number | undefined,
  formatRelativeTime: (ts: number) => string,
): React.ReactNode {
  if (columnCount === undefined) {
    return "No data synced yet";
  }
  return (
    <>
      {rowCount !== undefined ? `${rowCount} rows × ` : ""}
      {columnCount} columns
      {lastFetchedAt && (
        <> • Last synced: {formatRelativeTime(lastFetchedAt)}</>
      )}
    </>
  );
}

// Helper to determine preview content based on state
function PreviewContent({
  isPreviewCollapsed,
  hasDataTables,
  selectedDataTable,
  previewData,
  onExpandPreview,
}: {
  isPreviewCollapsed: boolean;
  hasDataTables: boolean;
  selectedDataTable: { fields: Field[] } | null;
  previewData: PreviewData | null;
  onExpandPreview: () => void;
}) {
  if (isPreviewCollapsed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-neutral-fg-subtle">Preview collapsed</p>
        <Button
          label="Expand preview"
          variant="outline"
          size="sm"
          onClick={onExpandPreview}
        />
      </div>
    );
  }
  if (!hasDataTables) {
    return (
      <EmptyState message="No data tables configured. Create a visualization to add Notion databases." />
    );
  }
  if (!selectedDataTable) {
    return <EmptyState message="Select a data table to preview its data." />;
  }
  if (!previewData) {
    return (
      <EmptyState message="No data available. Create a visualization to fetch data from this Notion database." />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VirtualTable
        rows={previewData.rows}
        columns={previewData.columns}
        height="100%"
      />
    </div>
  );
}

// Helper component for local data source display with async data loading
function LocalDataSourceView({
  dataSource,
  dataTables,
}: {
  dataSource: { id: string; name: string; type: string };
  dataTables: DataTable[];
}) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(
    dataTables[0]?.id ?? null,
  );

  const selectedDataTable = dataTables.find((dt) => dt.id === selectedTableId);

  // Use async data loading hook
  const { data, isLoading, error, entry } = useDataFrameData(
    selectedDataTable?.dataFrameId,
  );

  const previewDescription = useMemo(() => {
    if (isLoading) return "Loading...";
    if (error) return `Error: ${error}`;
    if (data && selectedDataTable) return `Showing ${selectedDataTable.name}`;
    return "Select a file to preview";
  }, [data, error, isLoading, selectedDataTable]);

  const renderPreviewContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent bg-neutral-bg-muted" />
        </div>
      );
    }

    if (error) {
      return <EmptyState message={`Failed to load data: ${error}`} />;
    }

    if (data && selectedDataTable) {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <VirtualTable
            rows={data.rows}
            columns={selectedDataTable.fields
              .filter((f: Field) => !f.name.startsWith("_"))
              .map((f: Field) => ({
                name: f.columnName ?? f.name,
                type: f.type,
              }))}
            height="100%"
          />
        </div>
      );
    }

    return <EmptyState message="Select a file to preview its data." />;
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{dataSource.name}</CardTitle>
          <CardDescription>
            Local storage • {dataTables.length}{" "}
            {dataTables.length === 1 ? "file" : "files"}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Files List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Files</CardTitle>
          <CardDescription>
            {getFilesDescription(dataTables.length)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {dataTables.length === 0 ? (
            <EmptyState message="Upload CSV files to get started." />
          ) : (
            dataTables.map((table) => {
              const isSelected = table.id === selectedTableId;
              return (
                <button
                  key={table.id}
                  onClick={() => setSelectedTableId(table.id)}
                  className={cn(
                    "w-full rounded-lg border border-neutral-border/60 p-3 text-left transition-colors hover:border-neutral-border hover:bg-neutral-bg-emphasis/50",
                    isSelected && "border-palette-primary bg-palette-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm font-medium text-neutral-fg",
                          isSelected && "text-palette-primary",
                        )}
                      >
                        {table.name}
                      </p>
                      {/* Show entry metadata if available */}
                      {isSelected && entry && (
                        <p className="mt-1 text-xs text-neutral-fg-subtle">
                          {entry.rowCount ?? "?"} rows ×{" "}
                          {entry.columnCount ?? "?"} columns
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Data Preview */}
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle className="text-lg">Data Preview</CardTitle>
          <CardDescription>{previewDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {renderPreviewContent()}
        </CardContent>
      </Card>
    </div>
  );
}

// Notion-specific view component — owns all Notion JSX branching so that
// DataSourceDisplay's cognitive complexity stays within the sonarjs limit.
function NotionDataSourceView({
  dataSource,
  dataTables,
}: {
  dataSource: { id: string; type: string; config: { hasApiKey?: boolean } };
  dataTables: DataTable[];
}) {
  const [selectedDataTableId, setSelectedDataTableId] = useState<string | null>(
    null,
  );
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

  const selectedDataTable = useMemo(() => {
    if (dataTables.length === 0) return null;
    const explicit = selectedDataTableId
      ? (dataTables.find((dt) => dt.id === selectedDataTableId) ?? null)
      : null;
    return explicit ?? dataTables[0] ?? null;
  }, [dataTables, selectedDataTableId]);

  const {
    isRefreshing,
    notionPreviewData,
    handleSyncData,
    handleRefreshDataTable,
  } = useNotionSync(dataSource, selectedDataTable);

  const currentPreviewData =
    notionPreviewData?.tableId === selectedDataTable?.id
      ? notionPreviewData
      : null;

  const now = useSyncExternalStore(
    subscribeNow,
    getNowSnapshot,
    getNowServerSnapshot,
  );
  const fmtRelative = (ts: number) => formatRelativeTime(now, ts);

  const hasDataTables = dataTables.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      {selectedDataTable && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <DatabaseIcon className="h-5 w-5 text-neutral-fg-subtle" />
                  <CardTitle className="text-lg">
                    {selectedDataTable.name}
                  </CardTitle>
                </div>
                <CardDescription className="mt-1.5">
                  {getTableStatsDescription(
                    currentPreviewData?.rowCount,
                    currentPreviewData?.columns.length,
                    selectedDataTable.lastFetchedAt,
                    fmtRelative,
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {dataTables.length > 1 && (
                  <div className="flex gap-1">
                    {dataTables.map((dataTable) => (
                      <button
                        key={dataTable.id}
                        onClick={() => setSelectedDataTableId(dataTable.id)}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-neutral-bg-muted/50",
                          selectedDataTableId === dataTable.id
                            ? "border-palette-primary bg-palette-primary/5 font-medium text-neutral-fg"
                            : "border-neutral-border/40 text-neutral-fg-subtle",
                        )}
                      >
                        {dataTable.name}
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  label={isRefreshing ? "Syncing..." : "Sync Data"}
                  onClick={handleSyncData}
                  disabled={isRefreshing}
                  size="sm"
                  icon={RefreshIcon}
                  className={cn(isRefreshing && "[&_svg]:animate-spin")}
                />
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {!hasDataTables && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2 text-center">
              <DatabaseIcon className="h-8 w-8 text-neutral-fg-subtle/70" />
              <p className="text-sm font-medium text-neutral-fg">
                No tables configured
              </p>
              <p className="text-xs text-neutral-fg-subtle">
                Add databases from the left panel to get started
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">Data Preview</CardTitle>
              {selectedDataTable && currentPreviewData && (
                <Button
                  label={isRefreshing ? "Refreshing..." : "Refresh"}
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshDataTable}
                  disabled={isRefreshing}
                  className={cn("h-7", isRefreshing && "[&_svg]:animate-spin")}
                  icon={RefreshIcon}
                />
              )}
            </div>
            <CardDescription>
              {getPreviewDescription(
                selectedDataTable,
                currentPreviewData,
                fmtRelative,
              )}
            </CardDescription>
          </div>
          {selectedDataTable && currentPreviewData && (
            <Button
              label={isPreviewCollapsed ? "Expand preview" : "Collapse preview"}
              variant="ghost"
              size="sm"
              iconOnly
              onClick={() => setIsPreviewCollapsed(!isPreviewCollapsed)}
              className="shrink-0"
              icon={isPreviewCollapsed ? ChevronDownIcon : ChevronUpIcon}
            />
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PreviewContent
            isPreviewCollapsed={isPreviewCollapsed}
            hasDataTables={hasDataTables}
            selectedDataTable={selectedDataTable}
            previewData={currentPreviewData}
            onExpandPreview={() => setIsPreviewCollapsed(false)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// Decode a base64 Arrow IPC buffer (as returned by the server) into bytes the
// browser engine can persist. Lives at module scope so it's testable in
// isolation and out of the hook's complexity budget.
function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface MaterializedNotion {
  dataFrameId: UUID;
  rowCount: number;
  columnCount: number;
}

// Persist the server's serializable Notion result as a durable browser
// DataFrame and link it to the DataTable. This is what makes an added/synced
// Notion source survive a reload: the Arrow bytes land in IndexedDB, the
// DataFrame entry is registered, and the table is updated with its fields +
// dataFrameId (replacing any prior frame). Mirrors the local-CSV ingest path.
async function materializeNotionTable(
  table: { id: string },
  result: {
    arrowBuffer: string;
    fieldIds: string[];
    fields: Field[];
    rowCount: number;
  },
  name: string,
): Promise<MaterializedNotion> {
  const fields = result.fields;
  const columnCount = result.fieldIds.length;
  const bytes = decodeBase64ToBytes(result.arrowBuffer);
  const dataFrame = await DataFrame.create(bytes, result.fieldIds as UUID[]);

  // Re-read the table to resolve its current frame (avoids a stale prop on
  // re-sync) and replace-in-place rather than orphaning the old Arrow blob.
  const existing = await getDataTable(table.id as UUID);
  let dataFrameId: UUID;
  if (existing?.dataFrameId) {
    await replaceDataFrame(existing.dataFrameId, dataFrame, {
      rowCount: result.rowCount,
      columnCount,
    });
    dataFrameId = existing.dataFrameId;
  } else {
    await addDataFrameEntry(dataFrame, {
      name,
      rowCount: result.rowCount,
      columnCount,
    });
    dataFrameId = dataFrame.id as UUID;
  }

  // Persist fields AND the frame link, then stamp lastFetchedAt. After this the
  // table has a real schema and a durable frame — both survive a reload.
  await updateDataTable(table.id as UUID, {
    fields,
    dataFrameId,
    lastFetchedAt: Date.now(),
  });

  return { dataFrameId, rowCount: result.rowCount, columnCount };
}

// Hook that owns Notion query state and the server-side query call.
// Extracted from DataSourceDisplay so the branch-heavy async body does not
// contribute toward the component function's cognitive complexity budget.
function useNotionSync(
  dataSource: {
    id: string;
    type: string;
    config: { hasApiKey?: boolean };
  } | null,
  selectedDataTable: {
    id: string;
    table: string;
    name: string;
    dataFrameId?: string | null;
  } | null,
) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notionPreviewData, setNotionPreviewData] =
    useState<PreviewData | null>(null);
  const notionMutations = useNotionMutations();

  const runNotionQuery = async (successMsg: (n: number) => string) => {
    if (
      !selectedDataTable ||
      !dataSource ||
      dataSource.type !== "notion" ||
      !dataSource.config.hasApiKey
    ) {
      return;
    }

    setIsRefreshing(true);
    try {
      // Sync materializes the FULL database (no row cap): the persisted table
      // must hold the whole source so it survives a reload intact. The server's
      // `limit` arg stays available for a future preview-only fetch.
      const result = await notionMutations.queryDatabase(
        dataSource.id,
        selectedDataTable.table,
        selectedDataTable.id,
      );

      const columns = result.fields
        .filter((f) => !f.name.startsWith("_"))
        .map((f) => ({ name: f.columnName ?? f.name, type: f.type }));

      if (!columns.length) {
        toast.error("No columns found in the selected database");
        return;
      }

      // Persist the frame + fields BEFORE reporting success, so a reload finds
      // the data and schema intact (not just a refreshed timestamp).
      const materialized = await materializeNotionTable(
        selectedDataTable,
        result,
        selectedDataTable.name,
      );

      setNotionPreviewData({
        tableId: selectedDataTable.id,
        rows: [], // row data lives in IndexedDB; preview shows column schema
        columns,
        rowCount: materialized.rowCount,
      });

      toast.success(successMsg(columns.length));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync data",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  return {
    isRefreshing,
    notionPreviewData,
    handleSyncData: () =>
      runNotionQuery((n) => `Synced ${n} columns from Notion`),
    handleRefreshDataTable: () =>
      runNotionQuery(() => "Data refreshed successfully"),
  };
}

// Dispatches per data-source type (local / notion / unsupported).
export function DataSourceDisplay({ dataSourceId }: DataSourceDisplayProps) {
  const { data: dataSources } = useDataSources();
  const { data: allTables } = useDataTables(dataSourceId ?? undefined);

  const dataSource = useMemo(
    () => dataSources?.find((s) => s.id === dataSourceId) ?? null,
    [dataSources, dataSourceId],
  );

  const dataTables = useMemo(
    () => (dataSource ? (allTables ?? []) : []),
    [dataSource, allTables],
  );

  if (!dataSource) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Surface elevation="inset" className="w-full p-8 text-center">
          <DatabaseIcon className="mx-auto h-12 w-12 text-neutral-fg-subtle/50" />
          <p className="mt-4 text-base font-medium text-neutral-fg">
            No data source selected
          </p>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            Select a data source to view its tables and data.
          </p>
        </Surface>
      </div>
    );
  }

  if (dataSource.type === "local") {
    return (
      <LocalDataSourceView dataSource={dataSource} dataTables={dataTables} />
    );
  }

  if (dataSource.type === "notion") {
    return (
      <NotionDataSourceView dataSource={dataSource} dataTables={dataTables} />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Surface elevation="inset" className="w-full p-8 text-center">
        <p className="text-base font-medium text-neutral-fg">
          Unsupported data source type
        </p>
      </Surface>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-neutral-fg-subtle">
      <LayersIcon className="h-6 w-6 text-neutral-fg-subtle/70" />
      <p>{message}</p>
    </div>
  );
}
