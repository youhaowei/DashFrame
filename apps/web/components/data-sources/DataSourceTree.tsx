"use client";

import { useDataFrames, useDataSources, useDataTables } from "@dashframe/core";
import { DeleteIcon, FileIcon } from "@stdui/icons";
import { Button, EmptyState, Panel, cn } from "@stdui/react";
import { useMemo } from "react";

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
        <p className="text-sm text-neutral-fg-subtle">Data source not found</p>
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
              <h2 className="text-lg font-semibold text-neutral-fg">
                {dataSource.name}
              </h2>
              <p className="text-xs text-neutral-fg-subtle">
                {dataSource.type === "csv" ? "CSV files" : "Data source"}
              </p>
            </div>

            {/* Tables Header */}
            <div className="flex items-center gap-2">
              <FileIcon className="h-4 w-4 text-neutral-fg-subtle" />
              <h3 className="text-sm font-semibold text-neutral-fg">Tables</h3>
              <span className="rounded-full bg-neutral-bg-muted px-2 py-0.5 text-xs font-medium text-neutral-fg-subtle">
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
              label="Delete Table"
              variant="outline"
              size="sm"
              onClick={() => onDeleteTable(selectedTableId)}
              className="w-full text-palette-danger hover:bg-palette-danger hover:text-palette-danger-fg"
              icon={DeleteIcon}
            />
          </div>
        ) : undefined
      }
    >
      {/* Tables List */}
      <div className="space-y-2 p-4">
        {!tables || tables.length === 0 ? (
          <EmptyState
            icon={FileIcon}
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
                  "hover:border-neutral-border hover:bg-neutral-bg-emphasis/50",
                  isSelected
                    ? "border-palette-primary bg-palette-primary/5 shadow-sm"
                    : "border-neutral-border/60",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 rounded p-1.5",
                      isSelected
                        ? "bg-palette-primary/10 text-palette-primary"
                        : "bg-neutral-bg-muted text-neutral-fg-subtle",
                    )}
                  >
                    <FileIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        isSelected ? "text-palette-primary" : "text-neutral-fg",
                      )}
                    >
                      {table.name}
                    </p>
                    {entry && (
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
      </div>
    </Panel>
  );
}
