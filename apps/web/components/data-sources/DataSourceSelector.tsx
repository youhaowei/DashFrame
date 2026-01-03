"use client";

import { useMemo } from "react";
import {
  DatabaseIcon,
  PlusIcon,
  ChartIcon,
  NotionIcon,
  FileIcon,
  Button,
  Surface,
  ItemSelector,
  type SelectableItem,
  type ItemAction,
} from "@dashframe/ui";
import { useDataSources, useDataTables } from "@dashframe/core";
import Link from "next/link";

interface DataSourceSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
}

export function DataSourceSelector({
  selectedId,
  onSelect,
  onCreateClick,
}: DataSourceSelectorProps) {
  const { data: dataSources, isLoading } = useDataSources();
  const { data: allTables } = useDataTables();

  // Sort data sources by creation time (newest first)
  const sortedSources = useMemo(
    () => [...(dataSources ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [dataSources],
  );

  // Count tables per data source
  const tableCountBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const table of allTables ?? []) {
      counts.set(table.dataSourceId, (counts.get(table.dataSourceId) ?? 0) + 1);
    }
    return counts;
  }, [allTables]);

  const items: SelectableItem[] = useMemo(() => {
    return sortedSources.map((source) => {
      const isActive = source.id === selectedId;
      const tableCount = tableCountBySource.get(source.id) ?? 0;

      let icon;
      let metadata = "";

      if (source.type === "notion") {
        icon = NotionIcon;
        metadata = `${tableCount} ${tableCount === 1 ? "table" : "tables"}`;
      } else if (source.type === "csv") {
        icon = FileIcon;
        metadata = `${tableCount} ${tableCount === 1 ? "file" : "files"}`;
      }

      return {
        id: source.id,
        label: source.name,
        active: isActive,
        icon,
        metadata,
      };
    });
  }, [sortedSources, selectedId, tableCountBySource]);

  const actions: ItemAction[] = useMemo(
    () => [
      {
        label: "Visualizations",
        variant: "outlined",
        href: "/",
        icon: ChartIcon,
        tooltip: "View visualizations",
      },
      {
        label: "New Data Source",
        onClick: onCreateClick,
        icon: PlusIcon,
      },
    ],
    [onCreateClick],
  );

  if (isLoading) {
    return (
      <Surface elevation="raised" className="p-6">
        <p className="text-sm text-muted-foreground">Preparing data sources…</p>
      </Surface>
    );
  }

  if (sortedSources.length === 0) {
    return (
      <Surface elevation="inset" className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          <DatabaseIcon className="h-12 w-12" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Add your first data source
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload CSV files or connect to Notion to start analyzing your data.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            label="View Visualizations"
            variant="outlined"
            asChild
            size="sm"
          >
            <Link href="/">View Visualizations</Link>
          </Button>
          <Button
            label="Add Data Source"
            onClick={onCreateClick}
            size="sm"
            icon={PlusIcon}
          />
        </div>
      </Surface>
    );
  }

  return (
    <ItemSelector
      title="Data Sources"
      items={items}
      onItemSelect={onSelect}
      actions={actions}
    />
  );
}
