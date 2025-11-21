"use client";

import { useMemo } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { isLocalDataSource } from "@/lib/stores/types";
import { File, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/shared/SidePanel";
import { cn } from "@/lib/utils";

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
  const dataSource = useDataSourcesStore((state) => state.get(dataSourceId));
  const getDataFrame = useDataFramesStore((state) => state.get);

  const dataTables = useMemo(() => {
    if (!dataSource) return [];
    return Array.from(dataSource.dataTables?.values() ?? []);
  }, [dataSource]);

  const isLocal = dataSource && isLocalDataSource(dataSource);

  if (!dataSource) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Data source not found</p>
      </div>
    );
  }

  return (
    <SidePanel
      header={
        <div className="space-y-3">
          {/* Data Source Name */}
          <div>
            <h2 className="text-foreground text-lg font-semibold">
              {dataSource.name}
            </h2>
            <p className="text-muted-foreground text-xs">
              {dataSource.type === "local" ? "Local storage" : "Data source"}
            </p>
          </div>

          {/* Tables Header */}
          <div className="flex items-center gap-2">
            <File className="text-muted-foreground h-4 w-4" />
            <h3 className="text-foreground text-sm font-semibold">Tables</h3>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
              {dataTables.length}
            </span>
          </div>
        </div>
      }
      footer={
        !isLocal && selectedTableId ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDeleteTable(selectedTableId)}
            className="text-destructive hover:bg-destructive hover:text-destructive-foreground w-full"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Table
          </Button>
        ) : undefined
      }
    >
      {/* Tables List */}
      <div className="space-y-2">
        {dataTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <File className="text-muted-foreground/50 h-8 w-8" />
            <p className="text-muted-foreground text-sm">No tables yet</p>
            <p className="text-muted-foreground text-xs">
              Upload a CSV to get started
            </p>
          </div>
        ) : (
          dataTables.map((table) => {
            const dataFrame = table.dataFrameId
              ? getDataFrame(table.dataFrameId)
              : null;
            const isSelected = table.id === selectedTableId;

            return (
              <button
                key={table.id}
                onClick={() => onTableSelect(table.id)}
                className={cn(
                  "group w-full rounded-lg border p-3 text-left transition-all",
                  "hover:border-border hover:bg-accent/50",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/60"
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 rounded p-1.5",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <File className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        isSelected ? "text-primary" : "text-foreground"
                      )}
                    >
                      {table.name}
                    </p>
                    {dataFrame && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {dataFrame.metadata.rowCount} rows ×{" "}
                        {dataFrame.metadata.columnCount} columns
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </SidePanel>
  );
}
