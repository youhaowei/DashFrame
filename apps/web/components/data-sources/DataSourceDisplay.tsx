"use client";

import { useState, useEffect, useMemo } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import {
  isNotionDataSource,
  isCSVDataSource,
  type DataSource,
} from "@/lib/stores/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Surface, Button, ChevronDown, ChevronUp, Database, Layers, Refresh, cn } from "@dashframe/ui";
import { TableView } from "@/components/visualizations/TableView";
import { trpc } from "@/lib/trpc/Provider";
import { toast } from "sonner";
import type { NotionProperty } from "@dashframe/notion";
import { mapNotionTypeToColumnType } from "@dashframe/notion";
import { Input } from "@/components/fields/input";
import { MultiSelect } from "@/components/fields/multi-select";

interface DataSourceDisplayProps {
  dataSourceId: string | null;
}

// Helper component for local data source display
function LocalDataSourceView({
  dataSource,
  getDataFrame,
}: {
  dataSource: DataSource;
  getDataFrame: ReturnType<typeof useDataFramesStore.getState>["get"];
}) {
  const dataTables = Array.from(dataSource.dataTables?.values() ?? []);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(
    dataTables[0]?.id ?? null
  );

  const selectedDataTable = dataTables.find((dt) => dt.id === selectedTableId);
  const localDataFrame = selectedDataTable?.dataFrameId
    ? getDataFrame(selectedDataTable.dataFrameId)
    : null;

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
            {dataTables.length === 0
              ? "No files uploaded"
              : `${dataTables.length} ${dataTables.length === 1 ? "file" : "files"} available`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {dataTables.length === 0 ? (
            <EmptyState message="Upload CSV files to get started." />
          ) : (
            dataTables.map((table) => {
              const df = table.dataFrameId ? getDataFrame(table.dataFrameId) : null;
              const isSelected = table.id === selectedTableId;
              return (
                <button
                  key={table.id}
                  onClick={() => setSelectedTableId(table.id)}
                  className={cn(
                    "border-border/60 hover:border-border hover:bg-accent/50 w-full rounded-lg border p-3 text-left transition-colors",
                    isSelected && "border-primary bg-primary/5"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        "text-foreground truncate text-sm font-medium",
                        isSelected && "text-primary"
                      )}>
                        {table.name}
                      </p>
                      {df && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {df.metadata.rowCount} rows × {df.metadata.columnCount} columns
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
          <CardDescription>
            {localDataFrame && selectedDataTable
              ? `Showing ${selectedDataTable.name}`
              : "No data available"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {localDataFrame && selectedDataTable ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <TableView
                dataFrame={localDataFrame.data}
                fields={selectedDataTable.fields}
              />
            </div>
          ) : (
            <EmptyState message="Select a file to preview its data." />
          )}
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

  // Get data source from store
  const dataSource = useDataSourcesStore((state) =>
    dataSourceId ? state.get(dataSourceId) : null,
  );

  const getDataFrame = useDataFramesStore((state) => state.get);
  const updateDataFrameById = useDataFramesStore((state) => state.updateById);
  const refreshDataTable = useDataSourcesStore(
    (state) => state.refreshDataTable,
  );

  // tRPC mutations for Notion
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();
  const getSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();

  // Get DataTables for the selected source
  const dataTables = useMemo(() => {
    if (!dataSource) return [];
    if (isNotionDataSource(dataSource)) {
      return Array.from(dataSource.dataTables?.values() ?? []);
    }
    return [];
  }, [dataSource]);

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
      if (!selectedDataTable || !dataSource || !isNotionDataSource(dataSource)) {
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
  }, [selectedDataTable, dataSource]);

  // Get the DataFrame for the selected DataTable
  const dataFrame = useMemo(() => {
    if (!selectedDataTable?.dataFrameId) return null;
    return getDataFrame(selectedDataTable.dataFrameId);
  }, [selectedDataTable, getDataFrame]);

  // Note: Insight tracking removed - not currently used in this component

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
    if (!selectedDataTable || !dataSource || !isNotionDataSource(dataSource)) {
      return;
    }

    if (selectedPropertyIds.length === 0) {
      toast.error("Please select at least one property");
      return;
    }

    setIsRefreshing(true);
    try {
      // Fetch data from Notion API with selected properties
      const dataFrame = await queryDatabaseMutation.mutateAsync({
        apiKey: dataSource.apiKey,
        databaseId: selectedDataTable.table,
        selectedPropertyIds,
      });

      if (!dataFrame.columns || !dataFrame.columns.length) {
        toast.error("No data found in the selected database");
        return;
      }

      // Update or create DataFrame in store
      const dataFramesStore = useDataFramesStore.getState();
      if (selectedDataTable.dataFrameId) {
        // Update existing DataFrame
        updateDataFrameById(selectedDataTable.dataFrameId, dataFrame);
        refreshDataTable(
          dataSource.id,
          selectedDataTable.id,
          selectedDataTable.dataFrameId,
        );
      } else {
        // Create new DataFrame
        const newDataFrameId = dataFramesStore.createFromCSV(
          dataSource.id,
          `${selectedDataTable.name} (${new Date().toLocaleString()})`,
          dataFrame,
        );
        refreshDataTable(dataSource.id, selectedDataTable.id, newDataFrameId);
      }

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
    if (!selectedDataTable || !dataSource || !isNotionDataSource(dataSource)) {
      return;
    }

    if (!selectedDataTable.dataFrameId) {
      toast.error("No cached data to refresh");
      return;
    }

    setIsRefreshing(true);
    try {
      // Re-fetch data from Notion API
      const dataFrame = await queryDatabaseMutation.mutateAsync({
        apiKey: dataSource.apiKey,
        databaseId: selectedDataTable.table,
        selectedPropertyIds,
      });

      if (!dataFrame.columns || !dataFrame.columns.length) {
        toast.error("No data found in the selected database");
        return;
      }

      // Update DataFrame in store
      updateDataFrameById(selectedDataTable.dataFrameId, dataFrame);

      // Update DataTable with new lastFetchedAt
      refreshDataTable(
        dataSource.id,
        selectedDataTable.id,
        selectedDataTable.dataFrameId,
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
          <Database className="text-muted-foreground/50 mx-auto h-12 w-12" />
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

  const isLocal = isCSVDataSource(dataSource);

  // For local sources, show DataTables
  if (isLocal) {
    return (
      <LocalDataSourceView
        dataSource={dataSource}
        getDataFrame={getDataFrame}
      />
    );
  }

  // For Notion sources, show DataTables
  if (isNotionDataSource(dataSource)) {
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
                    <Database className="text-muted-foreground h-5 w-5" />
                    <CardTitle className="text-lg">
                      {selectedDataTable.name}
                    </CardTitle>
                  </div>
                  <CardDescription className="mt-1.5">
                    {dataFrame ? (
                      <>
                        {dataFrame.metadata.rowCount} rows ×{" "}
                        {dataFrame.metadata.columnCount} columns
                        {selectedDataTable.lastFetchedAt && (
                          <>
                            {" "}
                            • Last synced:{" "}
                            {formatRelativeTime(
                              selectedDataTable.lastFetchedAt,
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      "No data synced yet"
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
                    onClick={handleSyncData}
                    disabled={
                      isRefreshing ||
                      isFetchingSchema ||
                      selectedPropertyIds.length === 0
                    }
                    size="sm"
                  >
                    <Refresh
                      className={cn(
                        "mr-2 h-4 w-4",
                        isRefreshing && "animate-spin",
                      )}
                    />
                    {isRefreshing ? "Syncing..." : "Sync Data"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-[1fr,auto] sm:items-end">
                {/* Properties Multiselect */}
                {isFetchingSchema ? (
                  <div className="space-y-2">
                    <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3">
                      <Refresh className="h-3 w-3 animate-spin" />
                      <span className="text-muted-foreground text-xs">
                        Loading...
                      </span>
                    </div>
                  </div>
                ) : (
                  <MultiSelect
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
                <Input
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
                <Database className="text-muted-foreground/70 h-8 w-8" />
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
                  dataFrame &&
                  isNotionDataSource(dataSource) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRefreshDataTable}
                      disabled={isRefreshing}
                      className="h-7"
                    >
                      <Refresh
                        className={cn(
                          "mr-1.5 h-3.5 w-3.5",
                          isRefreshing && "animate-spin",
                        )}
                      />
                      {isRefreshing ? "Refreshing..." : "Refresh"}
                    </Button>
                  )}
              </div>
              <CardDescription>
                {(() => {
                  if (!selectedDataTable) {
                    return "Select a table to preview data";
                  }
                  if (!dataFrame) {
                    return `No data available for ${JSON.stringify(selectedDataTable.name)}`;
                  }
                  return (
                    <>
                      Showing data from {JSON.stringify(selectedDataTable.name)}{" "}
                      • First 50 rows
                      {selectedDataTable.lastFetchedAt && (
                        <>
                          {" "}
                          • Last fetched:{" "}
                          {formatRelativeTime(selectedDataTable.lastFetchedAt)}
                        </>
                      )}
                    </>
                  );
                })()}
              </CardDescription>
            </div>
            {selectedDataTable && dataFrame && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsPreviewCollapsed(!isPreviewCollapsed)}
                aria-label={
                  isPreviewCollapsed ? "Expand preview" : "Collapse preview"
                }
                className="shrink-0"
              >
                {isPreviewCollapsed ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {(() => {
              if (isPreviewCollapsed) {
                return (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                    <p className="text-muted-foreground text-sm">
                      Preview collapsed
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsPreviewCollapsed(false)}
                    >
                      Expand preview
                    </Button>
                  </div>
                );
              }
              if (!hasDataTables) {
                return (
                  <EmptyState message="No data tables configured. Create a visualization to add Notion databases." />
                );
              }
              if (!selectedDataTable) {
                return (
                  <EmptyState message="Select a data table to preview its data." />
                );
              }
              if (!dataFrame) {
                return (
                  <EmptyState message="No data available. Create a visualization to fetch data from this Notion database." />
                );
              }
              return (
                <div className="flex min-h-0 flex-1 flex-col">
                  <TableView
                    dataFrame={dataFrame.data}
                    fields={selectedDataTable.fields}
                  />
                </div>
              );
            })()}
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
      <Layers className="text-muted-foreground/70 h-6 w-6" />
      <p>{message}</p>
    </div>
  );
}
