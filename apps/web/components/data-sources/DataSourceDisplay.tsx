"use client";

import { useState, useEffect, useMemo } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import {
  isNotionDataSource,
  isCSVDataSource,
  type DataSource,
} from "@/lib/stores/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Database,
  Layers,
  Refresh,
} from "@/components/icons";
import { TableView } from "@/components/visualizations/TableView";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/Provider";
import { toast } from "sonner";

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
  const firstDataTable = dataTables[0];
  const localDataFrame = firstDataTable?.dataFrameId
    ? getDataFrame(firstDataTable.dataFrameId)
    : null;

  return (
    <div className="flex h-full flex-col gap-4">
      <Card className="border-border/60 bg-card/80 border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">{dataSource.name}</CardTitle>
          <CardDescription>
            Local storage • {dataTables.length}{" "}
            {dataTables.length === 1 ? "file" : "files"}
            {localDataFrame &&
              ` • ${localDataFrame.metadata.rowCount} rows × ${localDataFrame.metadata.columnCount} columns`}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-border/60 bg-card/80 flex min-h-0 flex-1 flex-col border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Data Preview</CardTitle>
          <CardDescription>
            {localDataFrame
              ? `Showing ${firstDataTable.name}`
              : "No data available"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {localDataFrame ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <TableView dataFrame={localDataFrame.data} />
            </div>
          ) : (
            <EmptyState message="Upload CSV files to preview data." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DataSourceDisplay({ dataSourceId }: DataSourceDisplayProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedDataTableId, setSelectedDataTableId] = useState<string | null>(
    null,
  );
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get data source from store
  const dataSource = useDataSourcesStore((state) =>
    dataSourceId ? state.get(dataSourceId) : null,
  );

  const getDataFrame = useDataFramesStore((state) => state.get);
  const updateDataFrameById = useDataFramesStore((state) => state.updateById);
  const refreshDataTable = useDataSourcesStore(
    (state) => state.refreshDataTable,
  );

  // tRPC mutation for refreshing Notion data
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();

  // Wait for client-side hydration
  useEffect(() => {
    setIsHydrated(true);
  }, []);

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

  // Handle refreshing Notion data
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
        selectedPropertyIds: selectedDataTable.dimensions,
      });

      if (!dataFrame.columns.length) {
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

  // Don't render until hydrated to avoid hydration mismatch
  if (!isHydrated) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center p-6 text-sm">
        Loading display…
      </div>
    );
  }

  if (!dataSource) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="border-border/70 bg-background/40 w-full rounded-2xl border border-dashed p-8 text-center">
          <Database className="text-muted-foreground/50 mx-auto h-12 w-12" />
          <p className="text-foreground mt-4 text-base font-medium">
            No data source selected
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Select a data source to view its tables and data.
          </p>
        </div>
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
        {/* Header */}
        <Card className="border-border/60 bg-card/80 border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{dataSource.name}</CardTitle>
            <CardDescription>
              Notion data source • {dataTables.length}{" "}
              {dataTables.length === 1 ? "table" : "tables"}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* DataTables List */}
        {hasDataTables && (
          <Card className="border-border/60 bg-card/80 border shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Data Tables</CardTitle>
              <CardDescription>
                Notion databases configured for this connection
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {dataTables.map((dataTable) => (
                  <button
                    key={dataTable.id}
                    onClick={() => setSelectedDataTableId(dataTable.id)}
                    className={cn(
                      "hover:bg-muted/50 w-full rounded-lg border p-3 text-left transition-all",
                      selectedDataTableId === dataTable.id
                        ? "border-primary bg-primary/5"
                        : "border-border/40 bg-background/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-foreground text-sm font-medium">
                          {dataTable.name}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {dataTable.dimensions.length}{" "}
                          {dataTable.dimensions.length === 1
                            ? "property"
                            : "properties"}
                        </p>
                      </div>
                      <Database className="text-muted-foreground h-4 w-4" />
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Data Preview */}
        <Card className="border-border/60 bg-card/80 flex min-h-0 flex-1 flex-col border shadow-sm">
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
                  <TableView dataFrame={dataFrame.data} />
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
      <div className="border-border/70 bg-background/40 w-full rounded-2xl border border-dashed p-8 text-center">
        <p className="text-foreground text-base font-medium">
          Unsupported data source type
        </p>
      </div>
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
