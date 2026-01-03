"use client";

import { useState, useEffect, useMemo } from "react";
import {
  useDataSources,
  useDataTables,
  useDataTableMutations,
} from "@dashframe/core";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import type { DataTable, Field } from "@dashframe/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Surface,
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  DatabaseIcon,
  LayersIcon,
  RefreshIcon,
  cn,
  InputField,
  MultiSelectField,
  VirtualTable,
  type VirtualTableColumn,
} from "@dashframe/ui";
import { trpc } from "@/lib/trpc/Provider";
import { toast } from "sonner";
import type { NotionProperty } from "@dashframe/connector-notion";
import { mapNotionTypeToColumnType } from "@dashframe/connector-notion";

interface DataSourceDisplayProps {
  dataSourceId: string | null;
}

// Preview data type for Notion sources
interface PreviewData {
  rows: Record<string, unknown>[];
  columns: VirtualTableColumn[];
  rowCount: number;
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
  return (
    <>
      Showing data from {JSON.stringify(selectedDataTable.name)} •{" "}
      {previewData.rowCount} rows
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

// Helper to get table stats description
function getTableStatsDescription(
  rowCount: number | undefined,
  columnCount: number | undefined,
  lastFetchedAt: number | undefined,
  formatRelativeTime: (ts: number) => string,
): React.ReactNode {
  if (rowCount === undefined || columnCount === undefined) {
    return "No data synced yet";
  }
  return (
    <>
      {rowCount} rows × {columnCount} columns
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
        <p className="text-muted-foreground text-sm">Preview collapsed</p>
        <Button
          label="Expand preview"
          variant="outlined"
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
          <div className="bg-muted h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
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
                    "border-border/60 hover:border-border hover:bg-accent/50 w-full rounded-lg border p-3 text-left transition-colors",
                    isSelected && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-foreground truncate text-sm font-medium",
                          isSelected && "text-primary",
                        )}
                      >
                        {table.name}
                      </p>
                      {/* Show entry metadata if available */}
                      {isSelected && entry && (
                        <p className="text-muted-foreground mt-1 text-xs">
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

export function DataSourceDisplay({ dataSourceId }: DataSourceDisplayProps) {
  const [selectedDataTableId, setSelectedDataTableId] = useState<string | null>(
    null,
  );
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingSchema, setIsFetchingSchema] = useState(false);
  const [databaseSchema, setDatabaseSchema] = useState<NotionProperty[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [rowLimit, setRowLimit] = useState<number>(50);
  // Preview data for Notion tables (rows + columns from last sync)
  const [notionPreviewData, setNotionPreviewData] =
    useState<PreviewData | null>(null);

  // Get data source from Dexie
  const { data: dataSources } = useDataSources();
  const { data: allTables } = useDataTables(dataSourceId ?? undefined);
  const tableMutations = useDataTableMutations();

  const dataSource = useMemo(
    () => dataSources?.find((s) => s.id === dataSourceId) ?? null,
    [dataSources, dataSourceId],
  );

  // tRPC mutations for Notion
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();
  const getSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();

  // Get DataTables for the selected source (already filtered by dataSourceId)
  const dataTables = useMemo(() => {
    if (!dataSource) return [];
    return allTables ?? [];
  }, [dataSource, allTables]);

  // Auto-select first DataTable if none selected
  useEffect(() => {
    if (dataTables.length > 0 && !selectedDataTableId) {
      setSelectedDataTableId(dataTables[0].id);
    }
  }, [dataTables, selectedDataTableId]);

  // Get the selected DataTable
  const selectedDataTable = useMemo(() => {
    if (!selectedDataTableId) return null;
    return dataTables.find((dt) => dt.id === selectedDataTableId) ?? null;
  }, [dataTables, selectedDataTableId]);

  // Fetch database schema when a table is selected
  useEffect(() => {
    const fetchSchema = async () => {
      if (
        !selectedDataTable ||
        !dataSource ||
        dataSource.type !== "notion" ||
        !dataSource.apiKey
      ) {
        return;
      }

      setIsFetchingSchema(true);
      try {
        const schema = await getSchemaMutation.mutateAsync({
          apiKey: dataSource.apiKey,
          databaseId: selectedDataTable.table,
        });
        setDatabaseSchema(schema);

        // Default: select all properties
        // Note: Previously used DataTable.dimensions, now we select all by default
        setSelectedPropertyIds(schema.map((p) => p.id));
      } catch (error) {
        console.error("Failed to fetch database schema:", error);
        toast.error("Failed to load database fields");
      } finally {
        setIsFetchingSchema(false);
      }
    };

    fetchSchema();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getSchemaMutation is a stable mutation hook, adding it would cause infinite loops
  }, [selectedDataTable, dataSource]);

  // Format relative time for "last fetched"
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  };

  // Handle syncing data with selected properties
  const handleSyncData = async () => {
    if (
      !selectedDataTable ||
      !dataSource ||
      dataSource.type !== "notion" ||
      !dataSource.apiKey
    ) {
      return;
    }

    if (selectedPropertyIds.length === 0) {
      toast.error("Please select at least one property");
      return;
    }

    setIsRefreshing(true);
    try {
      // Fetch data from Notion API with selected properties
      // Returns NotionConversionResult: { rows, columns, arrowBuffer, fieldIds, rowCount }
      const result = await queryDatabaseMutation.mutateAsync({
        apiKey: dataSource.apiKey,
        databaseId: selectedDataTable.table,
        selectedPropertyIds,
      });

      if (!result.columns || !result.columns.length) {
        toast.error("No data found in the selected database");
        return;
      }

      // Update preview data for display
      setNotionPreviewData({
        rows: result.rows,
        columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
        rowCount: result.rowCount,
      });

      // Update DataTable timestamp
      await tableMutations.refresh(
        selectedDataTable.id,
        selectedDataTable.dataFrameId ?? crypto.randomUUID(),
      );

      toast.success("Data synced successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync data",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle refreshing Notion data (uses existing property selection)
  const handleRefreshDataTable = async () => {
    if (
      !selectedDataTable ||
      !dataSource ||
      dataSource.type !== "notion" ||
      !dataSource.apiKey
    ) {
      return;
    }

    if (!notionPreviewData) {
      toast.error("No cached data to refresh");
      return;
    }

    setIsRefreshing(true);
    try {
      // Re-fetch data from Notion API
      // Returns NotionConversionResult: { rows, columns, arrowBuffer, fieldIds, rowCount }
      const result = await queryDatabaseMutation.mutateAsync({
        apiKey: dataSource.apiKey,
        databaseId: selectedDataTable.table,
        selectedPropertyIds,
      });

      if (!result.columns || !result.columns.length) {
        toast.error("No data found in the selected database");
        return;
      }

      // Update preview data for display
      setNotionPreviewData({
        rows: result.rows,
        columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
        rowCount: result.rowCount,
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
          <DatabaseIcon className="text-muted-foreground/50 mx-auto h-12 w-12" />
          <p className="text-foreground mt-4 text-base font-medium">
            No data source selected
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Select a data source to view its tables and data.
          </p>
        </Surface>
      </div>
    );
  }

  const isLocal = dataSource.type === "csv";

  // For CSV sources, show DataTables with async data loading
  if (isLocal) {
    return (
      <LocalDataSourceView dataSource={dataSource} dataTables={dataTables} />
    );
  }

  // For Notion sources, show DataTables
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
                    <DatabaseIcon className="text-muted-foreground h-5 w-5" />
                    <CardTitle className="text-lg">
                      {selectedDataTable.name}
                    </CardTitle>
                  </div>
                  <CardDescription className="mt-1.5">
                    {getTableStatsDescription(
                      notionPreviewData?.rowCount,
                      notionPreviewData?.columns.length,
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
                            "hover:bg-muted/50 rounded-md border px-3 py-1.5 text-xs transition-colors",
                            selectedDataTableId === dataTable.id
                              ? "border-primary bg-primary/5 text-foreground font-medium"
                              : "border-border/40 text-muted-foreground",
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
                    disabled={
                      isRefreshing ||
                      isFetchingSchema ||
                      selectedPropertyIds.length === 0
                    }
                    size="sm"
                    icon={RefreshIcon}
                    className={cn(isRefreshing && "[&_svg]:animate-spin")}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-[1fr,auto] sm:items-end">
                {/* Properties Multiselect */}
                {isFetchingSchema ? (
                  <div className="space-y-2">
                    <div className="border-input bg-background flex h-9 items-center gap-2 rounded-md border px-3">
                      <RefreshIcon className="h-3 w-3 animate-spin" />
                      <span className="text-muted-foreground text-xs">
                        Loading...
                      </span>
                    </div>
                  </div>
                ) : (
                  <MultiSelectField
                    label="Properties"
                    options={databaseSchema.map((p) => {
                      const dfType = mapNotionTypeToColumnType(p.type);
                      return {
                        value: p.id,
                        label: p.name,
                        description: `${p.type} → ${dfType}`,
                        type: dfType,
                      };
                    })}
                    value={selectedPropertyIds}
                    onChange={(newValue) => {
                      if (newValue.length === 0) {
                        toast.error("At least one property must be selected");
                        return;
                      }
                      setSelectedPropertyIds(newValue);
                    }}
                    placeholder="Select properties..."
                    disabled={isFetchingSchema}
                  />
                )}

                {/* Row Limit */}
                <InputField
                  label="Limit"
                  type="number"
                  value={rowLimit.toString()}
                  onChange={(value) =>
                    setRowLimit(Math.max(1, parseInt(value) || 1))
                  }
                  className="w-24"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty state if no tables configured */}
        {!hasDataTables && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-2 text-center">
                <DatabaseIcon className="text-muted-foreground/70 h-8 w-8" />
                <p className="text-foreground text-sm font-medium">
                  No tables configured
                </p>
                <p className="text-muted-foreground text-xs">
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
                  notionPreviewData &&
                  dataSource.type === "notion" && (
                    <Button
                      label={isRefreshing ? "Refreshing..." : "Refresh"}
                      variant="text"
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
                  notionPreviewData,
                  formatRelativeTime,
                )}
              </CardDescription>
            </div>
            {selectedDataTable && notionPreviewData && (
              <Button
                label={
                  isPreviewCollapsed ? "Expand preview" : "Collapse preview"
                }
                variant="text"
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
              previewData={notionPreviewData}
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
        <p className="text-foreground text-base font-medium">
          Unsupported data source type
        </p>
      </Surface>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm">
      <LayersIcon className="text-muted-foreground/70 h-6 w-6" />
      <p>{message}</p>
    </div>
  );
}
