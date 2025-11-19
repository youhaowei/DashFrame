"use client";

import { useMemo, useState } from "react";
import { Database, Plus, BarChart3, Notion, File } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  ItemSelector,
  type SelectableItem,
  type ItemAction,
} from "@/components/shared/ItemSelector";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { isNotionDataSource } from "@/lib/stores/types";
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
  const [isHydrated] = useState(() => typeof window !== "undefined");
  const dataSourcesMap = useDataSourcesStore((state) => state.dataSources);
  const dataSources = useMemo(
    () =>
      Array.from(dataSourcesMap.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [dataSourcesMap],
  );

  const items: SelectableItem[] = useMemo(() => {
    return dataSources.map((source) => {
      const isActive = source.id === selectedId;

      let icon;
      let metadata = "";

      if (isNotionDataSource(source)) {
        icon = Notion;
        const tableCount = source.dataTables?.size ?? 0;
        metadata = `${tableCount} ${tableCount === 1 ? "table" : "tables"}`;
      } else if (source.type === "local") {
        icon = File;
        const fileCount = source.dataTables?.size ?? 0;
        metadata = `${fileCount} ${fileCount === 1 ? "file" : "files"}`;
      }

      return {
        id: source.id,
        label: source.name,
        active: isActive,
        icon,
        metadata,
      };
    });
  }, [dataSources, selectedId]);

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

  if (!isHydrated) {
    return (
      <div className="border-border/60 bg-card/70 rounded-2xl border px-6 py-5 shadow-sm">
        <p className="text-muted-foreground text-sm">Preparing data sources…</p>
      </div>
    );
  }

  if (dataSources.length === 0) {
    return (
      <div className="border-border/70 bg-card/60 rounded-2xl border border-dashed px-6 py-8 text-center shadow-sm">
        <div className="bg-primary/15 text-primary mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Database className="h-5 w-5" />
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
      </div>
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
