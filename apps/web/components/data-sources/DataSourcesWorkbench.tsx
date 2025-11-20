"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { DataSourceSelector } from "./DataSourceSelector";
import { DataSourceControls } from "./DataSourceControls";
import { DataSourceDisplay } from "./DataSourceDisplay";
import { NewDataSourcePanel } from "./NewDataSourcePanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DataSourcesWorkbench() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const dataSourcesMap = useDataSourcesStore((state) => state.dataSources);
  const dataSources = useMemo(
    () =>
      Array.from(dataSourcesMap.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [dataSourcesMap],
  );

  // Auto-select first data source if none selected
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Hydrate on mount
  useEffect(() => {
    setIsHydrated(true);

    // Auto-select first data source after hydration
    if (dataSources.length > 0 && !selectedId) {
      setSelectedId(dataSources[0].id);
    }
  }, [dataSources, selectedId]);

  // Update selectedId if it becomes invalid (source was deleted)
  // Using a ref to prevent cascading renders
  const previousDataSourcesRef = useRef(dataSources);
  useEffect(() => {
    if (!isHydrated) return;

    const previousSources = previousDataSourcesRef.current;
    const sourcesChanged = previousSources.length !== dataSources.length;

    if (
      sourcesChanged &&
      selectedId &&
      !dataSourcesMap.has(selectedId) &&
      dataSources.length > 0
    ) {
      setSelectedId(dataSources[0].id);
    }
    previousDataSourcesRef.current = dataSources;
  }, [dataSources, selectedId, dataSourcesMap, isHydrated]);

  if (!isHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading workspace…</p>
      </div>
    );
  }

  return (
    <>
      <WorkbenchLayout
        selector={
          <DataSourceSelector
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreateClick={() => setIsCreateDialogOpen(true)}
          />
        }
        leftPanel={<DataSourceControls dataSourceId={selectedId} />}
      >
        <DataSourceDisplay dataSourceId={selectedId} />
      </WorkbenchLayout>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Add data source</DialogTitle>
          </DialogHeader>
          <NewDataSourcePanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
