import { requestHost } from "@/data/host";
import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import {
  getConnectorById,
  useRegistryVersion,
} from "@/lib/connectors/registry";
import { api } from "@dashframe/convex-backend/api";
import type {
  DataTable,
  InsightFetchDefinition,
  InsightFetchResult,
} from "@dashframe/types";
import { VirtualTable } from "@dashframe/ui";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Surface,
} from "@wystack/ui-react";
import { DatabaseIcon, LayersIcon, RefreshIcon } from "@wystack/ui-react/icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface DataSourceDisplayProps {
  dataSourceId: string | null;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-neutral-fg-subtle">
      <LayersIcon className="h-6 w-6 text-neutral-fg-subtle/70" />
      <p>{message}</p>
    </div>
  );
}

function localPreviewContent(
  data: ReturnType<typeof useDataFrameData>["data"],
  isLoading: boolean,
  error: string | null,
) {
  if (isLoading) return <EmptyState message="Loading…" />;
  if (error) return <EmptyState message={`Failed to load data: ${error}`} />;
  if (data)
    return (
      <VirtualTable rows={data.rows} columns={data.columns} height="100%" />
    );
  return <EmptyState message="Select a file to preview its data." />;
}

function fetchDescription(fetchResult: InsightFetchResult | null): string {
  if (fetchResult?.status === "ready") return `${fetchResult.rowCount} rows`;
  if (fetchResult?.status === "failed") return "Fetch failed";
  return "No data fetched";
}

function LocalDataSourceView({
  dataSource,
  dataTables,
}: {
  dataSource: { name: string };
  dataTables: DataTable[];
}) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(
    dataTables[0]?.id ?? null,
  );
  const selectedDataTable = dataTables.find(
    (table) => table.id === selectedTableId,
  );
  const { data, isLoading, error, entry } = useDataFrameData(
    selectedDataTable?.dataFrameId,
  );

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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dataTables.length === 0 ? (
            <EmptyState message="Upload CSV files to get started." />
          ) : (
            dataTables.map((table) => (
              <button
                key={table.id}
                onClick={() => setSelectedTableId(table.id)}
                className={cn(
                  "w-full rounded-lg border border-neutral-border/60 p-3 text-left",
                  table.id === selectedTableId &&
                    "border-palette-primary bg-palette-primary/5",
                )}
              >
                <p className="truncate text-sm font-medium text-neutral-fg">
                  {table.name}
                </p>
                {table.id === selectedTableId && entry && (
                  <p className="mt-1 text-xs text-neutral-fg-subtle">
                    {entry.rowCount ?? "?"} rows × {entry.columnCount ?? "?"}{" "}
                    columns
                  </p>
                )}
              </button>
            ))
          )}
        </CardContent>
      </Card>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle className="text-lg">Data Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {localPreviewContent(data, isLoading, error)}
        </CardContent>
      </Card>
    </div>
  );
}

/** Remote previews only retain the server-minted handle; page rows stay server-owned. */
function RemoteDataSourceView({
  dataSource,
  dataTables,
}: {
  dataSource: { name: string };
  dataTables: DataTable[];
}) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(
    dataTables[0]?.id ?? null,
  );
  const [fetchResult, setFetchResult] = useState<InsightFetchResult | null>(
    null,
  );
  const [isFetching, setIsFetching] = useState(false);
  const previewGeneration = useRef(0);
  const selectedTable = useMemo(
    () =>
      dataTables.find((table) => table.id === selectedTableId) ??
      dataTables[0] ??
      null,
    [dataTables, selectedTableId],
  );
  const readyHandle =
    fetchResult?.status === "ready" ? fetchResult.dataFrameId : undefined;
  const { data, isLoading } = useDataFrameData(readyHandle, {
    skip: !readyHandle,
  });

  const refresh = useCallback(async () => {
    if (!selectedTable) return;
    const current = ++previewGeneration.current;
    setIsFetching(true);
    const insight: InsightFetchDefinition = {
      baseTableId: selectedTable.id,
      selectedFields: [],
      metrics: [],
    };
    try {
      const result = await requestHost("fetchData", {
        insight,
      });
      if (current !== previewGeneration.current) return;
      setFetchResult(result);
      if (result.status === "failed") toast.error(result.message);
    } catch {
      if (current !== previewGeneration.current) return;
      setFetchResult({
        status: "failed",
        code: "FETCH_REQUEST_FAILED",
        message: "Live data could not be fetched.",
        retryable: true,
        diagnosticId: crypto.randomUUID(),
      });
    } finally {
      if (current === previewGeneration.current) setIsFetching(false);
    }
  }, [selectedTable]);

  let preview = <EmptyState message="Fetch data to preview this table." />;
  if (!selectedTable)
    preview = <EmptyState message="No data tables configured." />;
  else if (fetchResult?.status === "failed")
    preview = <EmptyState message={fetchResult.message} />;
  else if (isFetching || isLoading)
    preview = <EmptyState message="Fetching live data…" />;
  else if (data)
    preview = (
      <VirtualTable rows={data.rows} columns={data.columns} height="100%" />
    );
  const previewDescription = fetchDescription(fetchResult);

  return (
    <div className="flex h-full flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg">{dataSource.name}</CardTitle>
              <CardDescription>
                {selectedTable ? selectedTable.name : "No tables configured"}
              </CardDescription>
            </div>
            <Button
              label={isFetching ? "Fetching…" : "Fetch data"}
              onClick={refresh}
              disabled={!selectedTable || isFetching}
              size="sm"
              icon={RefreshIcon}
            />
          </div>
        </CardHeader>
        {dataTables.length > 1 && (
          <CardContent className="flex gap-1">
            {dataTables.map((table) => (
              <Button
                key={table.id}
                label={table.name}
                variant={table.id === selectedTable?.id ? "outline" : "ghost"}
                size="sm"
                onClick={() => {
                  ++previewGeneration.current;
                  setSelectedTableId(table.id);
                  setFetchResult(null);
                  setIsFetching(false);
                }}
              />
            ))}
          </CardContent>
        )}
      </Card>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle className="text-lg">Data Preview</CardTitle>
          <CardDescription>{previewDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {preview}
        </CardContent>
      </Card>
    </div>
  );
}

export function DataSourceDisplay({ dataSourceId }: DataSourceDisplayProps) {
  const { data: dataSources } = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const { data: allTables } = queryStatus(
    useQuery({
      query: api.app.listDataTables,
      args: { dataSourceId: dataSourceId ?? undefined },
    }),
  );
  useRegistryVersion();
  const dataSource = useMemo(
    () => dataSources?.find((source) => source.id === dataSourceId) ?? null,
    [dataSources, dataSourceId],
  );
  const dataTables = useMemo(
    () => (dataSource ? (allTables ?? []) : []),
    [dataSource, allTables],
  );
  if (!dataSource)
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Surface elevation="inset" className="w-full p-8 text-center">
          <DatabaseIcon className="mx-auto h-12 w-12 text-neutral-fg-subtle/50" />
          <p className="mt-4 text-base font-medium text-neutral-fg">
            No data source selected
          </p>
        </Surface>
      </div>
    );
  return getConnectorById(dataSource.type)?.sourceType === "file" ? (
    <LocalDataSourceView dataSource={dataSource} dataTables={dataTables} />
  ) : (
    <RemoteDataSourceView dataSource={dataSource} dataTables={dataTables} />
  );
}
