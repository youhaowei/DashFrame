import { useDataFrameData } from "@/hooks/useDataFrameData";
import {
  useDataSources,
  useDataTableMutations,
  useDataTables,
  useNotionMutations,
} from "@dashframe/core";
import type { DataTable, Field } from "@dashframe/types";
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
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { NOTION_ENABLED, NotionDeferredBanner } from "./NotionDeferredBanner";

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

// Dispatches per data-source type (local / notion / file) with branch-y
// guards on selection, loading, empty states.
export function DataSourceDisplay({ dataSourceId }: DataSourceDisplayProps) {
  const [selectedDataTableId, setSelectedDataTableId] = useState<string | null>(
    null,
  );
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Preview data for Notion tables (columns from last sync — rows not in serializable result)
  const [notionPreviewData, setNotionPreviewData] =
    useState<PreviewData | null>(null);

  const { data: dataSources } = useDataSources();
  const { data: allTables } = useDataTables(dataSourceId ?? undefined);
  const tableMutations = useDataTableMutations();
  const notionMutations = useNotionMutations();

  const dataSource = useMemo(
    () => dataSources?.find((s) => s.id === dataSourceId) ?? null,
    [dataSources, dataSourceId],
  );

  // Get DataTables for the selected source (already filtered by dataSourceId)
  const dataTables = useMemo(() => {
    if (!dataSource) return [];
    return allTables ?? [];
  }, [dataSource, allTables]);

  // Effective selection: fall back to the first table when none chosen or
  // when the chosen id no longer exists. Derived during render — no effect.
  const selectedDataTable = useMemo(() => {
    if (dataTables.length === 0) return null;
    const explicit = selectedDataTableId
      ? (dataTables.find((dt) => dt.id === selectedDataTableId) ?? null)
      : null;
    return explicit ?? dataTables[0] ?? null;
  }, [dataTables, selectedDataTableId]);

  // Suppress stale preview from a previously selected table: only show
  // notionPreviewData when its tableId matches the current selection.
  const currentPreviewData =
    notionPreviewData?.tableId === selectedDataTable?.id
      ? notionPreviewData
      : null;

  const now = useSyncExternalStore(
    subscribeNow,
    getNowSnapshot,
    getNowServerSnapshot,
  );

  // Format relative time for "last fetched"
  const formatRelativeTime = useCallback(
    (timestamp: number) => {
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}d ago`;
      if (hours > 0) return `${hours}h ago`;
      if (minutes > 0) return `${minutes}m ago`;
      return "just now";
    },
    [now],
  );

  // Handle syncing data — calls queryNotionDatabase server-side (no credential in renderer)
  const handleSyncData = async () => {
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
      const result = await notionMutations.queryDatabase(
        dataSource.id,
        selectedDataTable.table,
        selectedDataTable.id,
      );

      // Build column preview from field definitions returned by the server.
      // Rows are not in the serializable result (Arrow buffer stays server-side
      // until a visualization materializes it); show column schema only.
      const columns = result.fields
        .filter((f) => !f.name.startsWith("_"))
        .map((f) => ({ name: f.columnName ?? f.name, type: f.type }));

      if (!columns.length) {
        toast.error("No columns found in the selected database");
        return;
      }

      setNotionPreviewData({
        tableId: selectedDataTable.id,
        rows: [], // rows not in serializable result; preview shows columns only
        columns,
        // rowCount intentionally undefined: the serializable result carries no
        // materialized row count (Arrow buffer stays server-side). Display shows
        // column count instead until a visualization materializes the DataFrame.
      });

      // Update DataTable timestamp
      await tableMutations.refresh(
        selectedDataTable.id,
        selectedDataTable.dataFrameId ?? crypto.randomUUID(),
      );

      toast.success(`Synced ${columns.length} columns from Notion`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync data",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle refreshing Notion data — re-queries server-side (no credential in renderer)
  const handleRefreshDataTable = async () => {
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
      const result = await notionMutations.queryDatabase(
        dataSource.id,
        selectedDataTable.table,
        selectedDataTable.id,
      );

      const columns = result.fields
        .filter((f) => !f.name.startsWith("_"))
        .map((f) => ({ name: f.columnName ?? f.name, type: f.type }));

      setNotionPreviewData({
        tableId: selectedDataTable.id,
        rows: [],
        columns,
        // rowCount intentionally undefined (see handleSyncData comment)
      });

      // Update DataTable with new lastFetchedAt
      await tableMutations.refresh(
        selectedDataTable.id,
        selectedDataTable.dataFrameId ?? crypto.randomUUID(),
      );

      toast.success("Data refreshed successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to refresh data",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

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

  const isLocal = dataSource.type === "local";

  // For CSV sources, show DataTables with async data loading
  if (isLocal) {
    return (
      <LocalDataSourceView dataSource={dataSource} dataTables={dataTables} />
    );
  }

  // For Notion sources, show DataTables (or a deferred banner — see
  // NotionDeferredBanner — while the integration moves off web tRPC).
  const showNotionBanner = dataSource.type === "notion" && !NOTION_ENABLED;
  if (showNotionBanner) return <NotionDeferredBanner />;

  if (dataSource.type === "notion") {
    const hasDataTables = dataTables.length > 0;

    return (
      <div className="flex h-full flex-col gap-4">
        {/* Table Header & Configuration */}
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
                      formatRelativeTime,
                    )}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* Table Selector */}
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
                  {/* Sync Button */}
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

        {/* Empty state if no tables configured */}
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

        {/* Data Preview */}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Data Preview</CardTitle>
                {selectedDataTable &&
                  currentPreviewData &&
                  dataSource.type === "notion" && (
                    <Button
                      label={isRefreshing ? "Refreshing..." : "Refresh"}
                      variant="ghost"
                      size="sm"
                      onClick={handleRefreshDataTable}
                      disabled={isRefreshing}
                      className={cn(
                        "h-7",
                        isRefreshing && "[&_svg]:animate-spin",
                      )}
                      icon={RefreshIcon}
                    />
                  )}
              </div>
              <CardDescription>
                {getPreviewDescription(
                  selectedDataTable,
                  currentPreviewData,
                  formatRelativeTime,
                )}
              </CardDescription>
            </div>
            {selectedDataTable && currentPreviewData && (
              <Button
                label={
                  isPreviewCollapsed ? "Expand preview" : "Collapse preview"
                }
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
