"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useDataSources,
  useDataTables,
  useDataTableMutations,
  useDataFrames,
} from "@dashframe/core-dexie";
import { handleFileConnectorResult } from "@/lib/local-csv-handler";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { DataSourceSelector } from "./DataSourceSelector";
import { DataSourceTree } from "./DataSourceTree";
import { TableDetailPanel } from "./TableDetailPanel";
import { FieldEditorModal } from "./FieldEditorModal";
import { MetricEditorModal } from "./MetricEditorModal";
import { AddConnectionPanel } from "./AddConnectionPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@dashframe/ui";
import { toast } from "sonner";
import type { Field, Metric } from "@dashframe/core";
import type {
  FileSourceConnector,
  RemoteApiConnector,
  RemoteDatabase,
} from "@dashframe/engine";

export function DataSourcesWorkbench() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Dexie hooks for reading data
  const { data: dataSources, isLoading } = useDataSources();
  const { data: allTables } = useDataTables();
  const { data: allDataFrames } = useDataFrames();

  // Dexie mutations
  const tableMutations = useDataTableMutations();

  // Sort data sources by creation time (newest first)
  const sortedSources = useMemo(
    () => [...(dataSources ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [dataSources],
  );

  // Create lookup maps for quick access
  const dataSourcesMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof dataSources>[number]>();
    for (const source of dataSources ?? []) {
      map.set(source.id, source);
    }
    return map;
  }, [dataSources]);

  const tablesMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof allTables>[number]>();
    for (const table of allTables ?? []) {
      map.set(table.id, table);
    }
    return map;
  }, [allTables]);

  const dataFramesMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof allDataFrames>[number]>();
    for (const df of allDataFrames ?? []) {
      map.set(df.id, df);
    }
    return map;
  }, [allDataFrames]);

  // Selection state - user's explicit choice
  const [userSelectedDataSourceId, setUserSelectedDataSourceId] = useState<
    string | null
  >(null);
  const [userSelectedTableId, setUserSelectedTableId] = useState<string | null>(
    null,
  );

  // Modal state
  const [fieldEditorState, setFieldEditorState] = useState<{
    isOpen: boolean;
    field: Field | null;
  }>({ isOpen: false, field: null });
  const [metricEditorOpen, setMetricEditorOpen] = useState(false);
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    isOpen: boolean;
    tableId: string | null;
    tableName: string | null;
  }>({ isOpen: false, tableId: null, tableName: null });

  // Get tables for a specific source
  const getTablesForSource = useCallback(
    (sourceId: string) =>
      (allTables ?? []).filter((t) => t.dataSourceId === sourceId),
    [allTables],
  );

  // Derive effective selectedDataSourceId using useMemo (no setState in effect)
  // Falls back to first source if user selection is null or invalid
  const selectedDataSourceId = useMemo(() => {
    // If user has selected a valid source, use it
    if (
      userSelectedDataSourceId &&
      dataSourcesMap.has(userSelectedDataSourceId)
    ) {
      return userSelectedDataSourceId;
    }
    // Otherwise, auto-select first source if available
    return sortedSources.length > 0 ? sortedSources[0].id : null;
  }, [userSelectedDataSourceId, dataSourcesMap, sortedSources]);

  // Derive effective selectedTableId using useMemo
  // Falls back to first table if user selection is null or invalid
  const selectedTableId = useMemo(() => {
    if (!selectedDataSourceId) return null;

    const tables = getTablesForSource(selectedDataSourceId);
    if (tables.length === 0) return null;

    // If user selected a valid table in this source, use it
    if (userSelectedTableId && tablesMap.has(userSelectedTableId)) {
      const table = tablesMap.get(userSelectedTableId);
      if (table?.dataSourceId === selectedDataSourceId) {
        return userSelectedTableId;
      }
    }
    // Otherwise auto-select first table
    return tables[0].id;
  }, [
    selectedDataSourceId,
    userSelectedTableId,
    getTablesForSource,
    tablesMap,
  ]);

  // Handler to update both source and reset table selection
  const handleDataSourceSelect = (sourceId: string | null) => {
    setUserSelectedDataSourceId(sourceId);
    setUserSelectedTableId(null); // Reset table when source changes
  };

  // Handler to update table selection
  const handleTableSelect = (tableId: string | null) => {
    setUserSelectedTableId(tableId);
  };

  // Get selected data table and data frame
  const selectedDataTable = useMemo(() => {
    if (!selectedTableId) return null;
    return tablesMap.get(selectedTableId) ?? null;
  }, [selectedTableId, tablesMap]);

  const selectedDataFrameEntry = useMemo(() => {
    if (!selectedDataTable?.dataFrameId) return null;
    return dataFramesMap.get(selectedDataTable.dataFrameId) ?? null;
  }, [selectedDataTable, dataFramesMap]);

  // Event Handlers
  const handleDeleteTable = (tableId: string) => {
    const dataTable = tablesMap.get(tableId);
    if (!dataTable) return;

    setDeleteConfirmState({
      isOpen: true,
      tableId,
      tableName: dataTable.name,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmState.tableId) return;

    await tableMutations.remove(deleteConfirmState.tableId);
    toast.success("Table deleted successfully");
    setDeleteConfirmState({ isOpen: false, tableId: null, tableName: null });
  };

  const handleEditField = (fieldId: string) => {
    if (!selectedDataTable) return;
    const field = selectedDataTable.fields.find((f: Field) => f.id === fieldId);
    if (field) {
      setFieldEditorState({ isOpen: true, field });
    }
  };

  const handleSaveField = async (fieldId: string, updates: Partial<Field>) => {
    if (!selectedTableId) return;
    await tableMutations.updateField(selectedTableId, fieldId, updates);
    toast.success("Field updated successfully");
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!selectedTableId) return;
    await tableMutations.deleteField(selectedTableId, fieldId);
    toast.success("Field deleted successfully");
  };

  const handleAddField = () => {
    toast.info("Custom field creation coming soon");
  };

  const handleSaveMetric = async (metric: Omit<Metric, "id">) => {
    if (!selectedTableId) return;
    const metricWithId: Metric = {
      ...metric,
      id: crypto.randomUUID(),
    };
    await tableMutations.addMetric(selectedTableId, metricWithId);
    toast.success("Metric added successfully");
  };

  const handleDeleteMetric = async (metricId: string) => {
    if (!selectedTableId) return;
    await tableMutations.deleteMetric(selectedTableId, metricId);
    toast.success("Metric deleted successfully");
  };

  // Handle file selection from connectors (CSV, Excel, etc.)
  const handleFileSelect = useCallback(
    async (connector: FileSourceConnector, file: File) => {
      setUploadError(null);
      try {
        const tableId = crypto.randomUUID();
        const result = await connector.parse(file, tableId);

        const { dataTableId, dataSourceId } = await handleFileConnectorResult(
          file.name,
          result,
        );

        setIsCreateDialogOpen(false);
        setUserSelectedDataSourceId(dataSourceId);
        setUserSelectedTableId(dataTableId);
        toast.success(`Uploaded ${file.name}`);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to process file",
        );
      }
    },
    [],
  );

  // Handle remote connector connection (Notion, Airtable, etc.)
  const handleRemoteConnect = useCallback(
    (connector: RemoteApiConnector, databases: RemoteDatabase[]) => {
      // For now, just log - full implementation requires database selection UI
      console.log(`Connected to ${connector.name}:`, databases);
      toast.info(`Found ${databases.length} databases in ${connector.name}`);
      // NOTE: Show database selection UI, then proceed with data import
    },
    [],
  );

  const handleCreateVisualization = () => {
    if (!selectedDataSourceId || !selectedTableId) return;
    // Note: Implement create insight flow
    // For now, just navigate to create visualization page
    toast.info("Create visualization flow coming soon");
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading workspace…</p>
      </div>
    );
  }

  return (
    <>
      <WorkbenchLayout
        header={
          <div className="p-4">
            <DataSourceSelector
              selectedId={selectedDataSourceId}
              onSelect={handleDataSourceSelect}
              onCreateClick={() => setIsCreateDialogOpen(true)}
            />
          </div>
        }
        leftPanel={
          selectedDataSourceId ? (
            <DataSourceTree
              dataSourceId={selectedDataSourceId}
              selectedTableId={selectedTableId}
              onTableSelect={handleTableSelect}
              onDeleteTable={handleDeleteTable}
            />
          ) : null
        }
      >
        <div className="h-full overflow-hidden">
          <TableDetailPanel
            dataTable={selectedDataTable}
            dataFrameEntry={selectedDataFrameEntry}
            onCreateVisualization={handleCreateVisualization}
            onEditField={handleEditField}
            onDeleteField={handleDeleteField}
            onAddField={handleAddField}
            onAddMetric={() => setMetricEditorOpen(true)}
            onDeleteMetric={handleDeleteMetric}
            onDeleteTable={() =>
              selectedTableId && handleDeleteTable(selectedTableId)
            }
          />
        </div>
      </WorkbenchLayout>

      {/* New Data Source Dialog */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) setUploadError(null);
        }}
      >
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Add data source</DialogTitle>
          </DialogHeader>
          <AddConnectionPanel
            error={uploadError}
            onFileSelect={handleFileSelect}
            onConnect={handleRemoteConnect}
          />
        </DialogContent>
      </Dialog>

      {/* Field Editor Modal */}
      <FieldEditorModal
        isOpen={fieldEditorState.isOpen}
        field={fieldEditorState.field}
        onSave={handleSaveField}
        onClose={() => setFieldEditorState({ isOpen: false, field: null })}
      />

      {/* Metric Editor Modal */}
      <MetricEditorModal
        isOpen={metricEditorOpen}
        tableId={selectedTableId || ""}
        availableFields={selectedDataTable?.fields || []}
        onSave={handleSaveMetric}
        onClose={() => setMetricEditorOpen(false)}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmState.isOpen}
        onOpenChange={(open) =>
          !open &&
          setDeleteConfirmState({
            isOpen: false,
            tableId: null,
            tableName: null,
          })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Table</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;
              {deleteConfirmState.tableName}&quot;? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDeleteConfirmState({
                  isOpen: false,
                  tableId: null,
                  tableName: null,
                })
              }
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete Table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
