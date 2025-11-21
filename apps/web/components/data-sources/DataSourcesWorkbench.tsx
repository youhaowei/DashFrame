"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { DataSourceSelector } from "./DataSourceSelector";
import { DataSourceTree } from "./DataSourceTree";
import { TableDetailPanel } from "./TableDetailPanel";
import { FieldEditorModal } from "./FieldEditorModal";
import { MetricEditorModal } from "./MetricEditorModal";
import { NewDataSourcePanel } from "./NewDataSourcePanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } from "@dashframe/ui";
import { toast } from "sonner";
import type { Field, Metric } from "@dashframe/dataframe";

export function DataSourcesWorkbench() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Store hooks
  const dataSourcesMap = useDataSourcesStore((state) => state.dataSources);
  const removeDataTable = useDataSourcesStore((state) => state.removeDataTable);
  const addField = useDataSourcesStore((state) => state.addField);
  const updateField = useDataSourcesStore((state) => state.updateField);
  const deleteField = useDataSourcesStore((state) => state.deleteField);
  const addMetric = useDataSourcesStore((state) => state.addMetric);
  const deleteMetric = useDataSourcesStore((state) => state.deleteMetric);
  const getDataFrame = useDataFramesStore((state) => state.get);

  const dataSources = useMemo(
    () =>
      Array.from(dataSourcesMap.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [dataSourcesMap],
  );

  // Selection state
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

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

  // Hydrate on mount
  useEffect(() => {
    setIsHydrated(true);

    // Auto-select first data source after hydration
    if (dataSources.length > 0 && !selectedDataSourceId) {
      setSelectedDataSourceId(dataSources[0].id);
    }
  }, [dataSources, selectedDataSourceId]);

  // Update selectedDataSourceId if it becomes invalid (source was deleted)
  const previousDataSourcesRef = useRef(dataSources);
  useEffect(() => {
    if (!isHydrated) return;

    const previousSources = previousDataSourcesRef.current;
    const sourcesChanged = previousSources.length !== dataSources.length;

    if (
      sourcesChanged &&
      selectedDataSourceId &&
      !dataSourcesMap.has(selectedDataSourceId) &&
      dataSources.length > 0
    ) {
      setSelectedDataSourceId(dataSources[0].id);
    }
    previousDataSourcesRef.current = dataSources;
  }, [dataSources, selectedDataSourceId, dataSourcesMap, isHydrated]);

  // Auto-select first table when data source changes
  useEffect(() => {
    if (selectedDataSourceId) {
      const dataSource = dataSourcesMap.get(selectedDataSourceId);
      if (dataSource) {
        const tables = Array.from(dataSource.dataTables.values());
        if (tables.length > 0) {
          setSelectedTableId(tables[0].id);
        } else {
          setSelectedTableId(null);
        }
      }
    } else {
      setSelectedTableId(null);
    }
  }, [selectedDataSourceId, dataSourcesMap]);

  // Get selected data table and data frame
  const selectedDataTable = useMemo(() => {
    if (!selectedDataSourceId || !selectedTableId) return null;
    const dataSource = dataSourcesMap.get(selectedDataSourceId);
    if (!dataSource) return null;
    return dataSource.dataTables.get(selectedTableId) || null;
  }, [selectedDataSourceId, selectedTableId, dataSourcesMap]);

  const selectedDataFrame = useMemo(() => {
    if (!selectedDataTable?.dataFrameId) return null;
    return getDataFrame(selectedDataTable.dataFrameId) || null;
  }, [selectedDataTable, getDataFrame]);

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

  const handleCreateVisualization = () => {
    if (!selectedDataSourceId || !selectedTableId) return;
    // TODO: Implement create insight flow
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
        selector={
          <DataSourceSelector
            selectedId={selectedDataSourceId}
            onSelect={setSelectedDataSourceId}
            onCreateClick={() => setIsCreateDialogOpen(true)}
          />
        }
        leftPanel={
          selectedDataSourceId ? (
            <DataSourceTree
              dataSourceId={selectedDataSourceId}
              selectedTableId={selectedTableId}
              onTableSelect={setSelectedTableId}
              onDeleteTable={handleDeleteTable}
            />
          ) : null
        }
      >
        <TableDetailPanel
          dataTable={selectedDataTable}
          dataFrame={selectedDataFrame}
          onCreateVisualization={handleCreateVisualization}
          onEditField={handleEditField}
          onDeleteField={handleDeleteField}
          onAddField={handleAddField}
          onAddMetric={() => setMetricEditorOpen(true)}
          onDeleteMetric={handleDeleteMetric}
        />
      </WorkbenchLayout>

      {/* New Data Source Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Add data source</DialogTitle>
          </DialogHeader>
          <NewDataSourcePanel />
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
          setDeleteConfirmState({ isOpen: false, tableId: null, tableName: null })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Table</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteConfirmState.tableName}"?
              This action cannot be undone.
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
