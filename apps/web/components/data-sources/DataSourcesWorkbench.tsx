"use client";

import { useState, useMemo, useSyncExternalStore, useCallback } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
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
import type {
  Field,
  Metric,
  FileSourceConnector,
  RemoteApiConnector,
  RemoteDatabase,
} from "@dashframe/dataframe";

// Hydration detection using useSyncExternalStore (no setState in effect)
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function DataSourcesWorkbench() {
  // Use useSyncExternalStore for SSR-safe hydration detection
  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Store hooks
  const dataSourcesMap = useDataSourcesStore((state) => state.dataSources);
  const removeDataTable = useDataSourcesStore((state) => state.removeDataTable);
  const updateField = useDataSourcesStore((state) => state.updateField);
  const deleteField = useDataSourcesStore((state) => state.deleteField);
  const addMetric = useDataSourcesStore((state) => state.addMetric);
  const deleteMetric = useDataSourcesStore((state) => state.deleteMetric);
  const getEntry = useDataFramesStore((state) => state.getEntry);

  const dataSources = useMemo(
    () =>
      Array.from(dataSourcesMap.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [dataSourcesMap],
  );

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
    return dataSources.length > 0 ? dataSources[0].id : null;
  }, [userSelectedDataSourceId, dataSourcesMap, dataSources]);

  // Derive effective selectedTableId using useMemo
  // Falls back to first table if user selection is null or invalid
  const selectedTableId = useMemo(() => {
    if (!selectedDataSourceId) return null;
    const dataSource = dataSourcesMap.get(selectedDataSourceId);
    if (!dataSource) return null;

    const tables = Array.from(dataSource.dataTables.values());
    if (tables.length === 0) return null;

    // If user selected a valid table in this source, use it
    if (userSelectedTableId && dataSource.dataTables.has(userSelectedTableId)) {
      return userSelectedTableId;
    }
    // Otherwise auto-select first table
    return tables[0].id;
  }, [selectedDataSourceId, userSelectedTableId, dataSourcesMap]);

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
    if (!selectedDataSourceId || !selectedTableId) return null;
    const dataSource = dataSourcesMap.get(selectedDataSourceId);
    if (!dataSource) return null;
    return dataSource.dataTables.get(selectedTableId) || null;
  }, [selectedDataSourceId, selectedTableId, dataSourcesMap]);

  const selectedDataFrameEntry = useMemo(() => {
    if (!selectedDataTable?.dataFrameId) return null;
    return getEntry(selectedDataTable.dataFrameId) || null;
  }, [selectedDataTable, getEntry]);

  // Event Handlers
  const handleDeleteTable = (tableId: string) => {
    const dataTable = selectedDataTable;
    if (!dataTable) return;

    setDeleteConfirmState({
      isOpen: true,
      tableId,
      tableName: dataTable.name,
    });
  };

  const handleConfirmDelete = () => {
    if (!selectedDataSourceId || !deleteConfirmState.tableId) return;

    removeDataTable(selectedDataSourceId, deleteConfirmState.tableId);
    toast.success("Table deleted successfully");
    setDeleteConfirmState({ isOpen: false, tableId: null, tableName: null });
  };

  const handleEditField = (fieldId: string) => {
    if (!selectedDataTable) return;
    const field = selectedDataTable.fields.find((f) => f.id === fieldId);
    if (field) {
      setFieldEditorState({ isOpen: true, field });
    }
  };

  const handleSaveField = (fieldId: string, updates: Partial<Field>) => {
    if (!selectedDataSourceId || !selectedTableId) return;
    updateField(selectedDataSourceId, selectedTableId, fieldId, updates);
    toast.success("Field updated successfully");
  };

  const handleDeleteField = (fieldId: string) => {
    if (!selectedDataSourceId || !selectedTableId) return;
    deleteField(selectedDataSourceId, selectedTableId, fieldId);
    toast.success("Field deleted successfully");
  };

  const handleAddField = () => {
    toast.info("Custom field creation coming soon");
  };

  const handleSaveMetric = (metric: Omit<Metric, "id">) => {
    if (!selectedDataSourceId || !selectedTableId) return;
    const metricWithId: Metric = {
      ...metric,
      id: crypto.randomUUID(),
    };
    addMetric(selectedDataSourceId, selectedTableId, metricWithId);
    toast.success("Metric added successfully");
  };

  const handleDeleteMetric = (metricId: string) => {
    if (!selectedDataSourceId || !selectedTableId) return;
    deleteMetric(selectedDataSourceId, selectedTableId, metricId);
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
