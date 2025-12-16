"use client";

import { useMemo } from "react";
import { useDataSources, useDataTables, useDataFrames } from "@dashframe/core";
import { File, Trash2, Panel, EmptyState, cn } from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";

interface DataSourceTreeProps {
  dataSourceId: string;
  selectedTableId: string | null;
  onTableSelect: (tableId: string) => void;
  onDeleteTable: (tableId: string) => void;
}

export function DataSourceTree({
  dataSourceId,
  selectedTableId,
  onTableSelect,
  onDeleteTable,
}: DataSourceTreeProps) {
  const { data: dataSources } = useDataSources();
  const { data: tables } = useDataTables(dataSourceId);
  const { data: dataFrames } = useDataFrames();

  const dataSource = useMemo(
    () => dataSources?.find((s) => s.id === dataSourceId),
    [dataSources, dataSourceId],
  );

  // Create a map for quick DataFrame lookup
  const dataFrameMap = useMemo(() => {
    const map = new Map<string, { rowCount?: number; columnCount?: number }>();
    for (const df of dataFrames ?? []) {
      map.set(df.id, { rowCount: df.rowCount, columnCount: df.columnCount });
    }
    return map;
  }, [dataFrames]);

  const isLocal = dataSource?.type === "csv";

  if (!dataSource) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Data source not found</p>
      </div>
    );
  }

  return (
    <Panel
      header={
        <div className="px-4 py-4">
          <div className="space-y-3">
            {/* Data Source Name */}
            <div>
              <h2 className="text-foreground text-lg font-semibold">
                {dataSource.name}
              </h2>
              <p className="text-muted-foreground text-xs">
                {dataSource.type === "csv" ? "CSV files" : "Data source"}
              </p>
            </div>

            {/* Tables Header */}
            <div className="flex items-center gap-2">
              <File className="text-muted-foreground h-4 w-4" />
              <h3 className="text-foreground text-sm font-semibold">Tables</h3>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                {tables?.length ?? 0}
              </span>
            </div>
          </div>
        </div>
      }
      footer={
        !isLocal && selectedTableId ? (
          <div className="px-4 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeleteTable(selectedTableId)}
              className="text-destructive hover:bg-destructive hover:text-destructive-foreground w-full"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Table
            </Button>
          </div>
        ) : undefined
      }
    >
      {/* Tables List */}
      <div className="space-y-2 p-4">
        {!tables || tables.length === 0 ? (
          <EmptyState
            icon={File}
            title="No tables yet"
            description="Upload a CSV to get started"
            size="sm"
          />
        ) : (
          tables.map((table) => {
            const entry = table.dataFrameId
              ? dataFrameMap.get(table.dataFrameId)
              : null;
            const isSelected = table.id === selectedTableId;

            return (
              <button
                key={table.id}
                onClick={() => onTableSelect(table.id)}
                aria-selected={isSelected}
                role="option"
                className={cn(
                  "group w-full rounded-xl border p-3 text-left transition-all",
                  "hover:border-border hover:bg-accent/50",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/60",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 rounded p-1.5",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <File className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        isSelected ? "text-primary" : "text-foreground",
                      )}
                    >
                      {table.name}
                    </p>
                    {entry && (
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
      </div>
    </Panel>
  );
}
