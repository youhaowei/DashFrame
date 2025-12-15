"use client";

import { useMemo } from "react";
import {
  Database,
  Plus,
  BarChart3,
  Notion,
  File,
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
        icon = Notion;
        metadata = `${tableCount} ${tableCount === 1 ? "table" : "tables"}`;
      } else if (source.type === "csv") {
        icon = File;
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
        variant: "outline",
        href: "/",
        icon: BarChart3,
        tooltip: "View visualizations",
      },
      {
        label: "New Data Source",
        onClick: onCreateClick,
        icon: Plus,
      },
    ],
    [onCreateClick],
  );

  if (isLoading) {
    return (
      <Surface elevation="raised" className="p-6">
        <p className="text-muted-foreground text-sm">Preparing data sources…</p>
      </Surface>
    );
  }

  if (sortedSources.length === 0) {
    return (
      <Surface elevation="inset" className="p-8 text-center">
        <div className="bg-primary/15 text-primary mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Database className="h-12 w-12" />
        </div>
        <h2 className="text-foreground text-lg font-semibold">
          Add your first data source
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Upload CSV files or connect to Notion to start analyzing your data.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" asChild size="sm">
            <Link href="/">View Visualizations</Link>
          </Button>
          <Button onClick={onCreateClick} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Data Source
          </Button>
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
