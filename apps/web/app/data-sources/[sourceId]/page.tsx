"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Button,
  Input,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Database,
  TableIcon,
  Plus,
  Trash2,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ChevronLeft as LuArrowLeft,
  File as LuFileSpreadsheet,
  Cloud as LuCloud,
  MoreHorizontal as LuMoreHorizontal,
  Breadcrumb,
  ItemCard,
} from "@dashframe/ui";
import {
  useDataSources,
  useDataSourceMutations,
  useDataTables,
  useDataTableMutations,
  useDataFrames,
} from "@dashframe/core";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { VirtualTable } from "@dashframe/ui";
import type { UUID } from "@dashframe/types";
import { AppLayout } from "@/components/layouts/AppLayout";

interface PageProps {
  params: Promise<{ sourceId: string }>;
}

// Get icon for data source type
function getSourceTypeIcon(type: string) {
  switch (type) {
    case "notion":
      return <LuCloud className="h-5 w-5" />;
    case "local":
      return <LuFileSpreadsheet className="h-5 w-5" />;
    case "postgresql":
      return <Database className="h-5 w-5" />;
    default:
      return <Database className="h-5 w-5" />;
  }
}

/**
 * Data Source Detail Page
 *
 * Shows a single data source with:
 * - Source name and type
 * - List of tables within the source
 * - Selected table details (fields, metrics, preview)
 * - Actions to create insights from tables
 */
export default function DataSourcePage({ params }: PageProps) {
  const { sourceId } = use(params);
  const router = useRouter();

  // Dexie hooks
  const { data: allDataSources = [] } = useDataSources();
  const { update: updateDataSource } = useDataSourceMutations();
  const { remove: removeDataTable } = useDataTableMutations();
  const { data: allDataFrames = [] } = useDataFrames();

  // Find the data source
  const dataSource = allDataSources.find((s) => s.id === sourceId);
  const isLoading = false; // DataSources hook handles loading

  // Get tables for this data source (flat in Dexie)
  const { data: dataTables = [] } = useDataTables(sourceId);

  // Local state for selected table - use null to indicate "not yet selected by user"
  const [selectedTableId, setSelectedTableId] = useState<UUID | null>(null);

  // Effective selected table ID - either user selection or first table as default
  const effectiveSelectedTableId = selectedTableId ?? dataTables[0]?.id ?? null;

  // Get selected table details
  const tableDetails = useMemo(() => {
    if (!effectiveSelectedTableId) return null;
    const table = dataTables.find((t) => t.id === effectiveSelectedTableId);
    return table
      ? { dataTable: table, fields: table.fields, metrics: table.metrics }
      : null;
  }, [effectiveSelectedTableId, dataTables]);

  // Use source name directly - mutations update database which triggers re-render
  const sourceName = dataSource?.name ?? "";

  // Local state for delete confirmation
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    isOpen: boolean;
    tableId: UUID | null;
    tableName: string | null;
  }>({ isOpen: false, tableId: null, tableName: null });

  // Get DataFrame entry for metadata (row/column counts)
  const dataFrameEntry = useMemo(() => {
    const dataFrameId = tableDetails?.dataTable?.dataFrameId;
    if (!dataFrameId) return null;
    return allDataFrames.find((e) => e.id === dataFrameId);
  }, [tableDetails, allDataFrames]);

  // Load actual data for preview (async from IndexedDB)
  const { data: previewData, isLoading: isLoadingPreview } = useDataFrameData(
    tableDetails?.dataTable?.dataFrameId,
    { limit: 50 },
  );

  // Handle name change - directly update database, triggers re-render via hook
  const handleNameChange = async (newName: string) => {
    await updateDataSource(sourceId, { name: newName });
  };

  // Handle create insight from table
  const handleCreateInsight = (tableId: UUID) => {
    // Navigate to insights page with pre-selected table
    // The actual insight creation will happen there
    router.push(`/insights?newInsight=true&tableId=${tableId}`);
  };

  // Handle delete table
  const handleDeleteTable = () => {
    if (!selectedTableId || !tableDetails?.dataTable) return;

    setDeleteConfirmState({
      isOpen: true,
      tableId: selectedTableId,
      tableName: tableDetails.dataTable.name,
    });
  };

  // Handle confirm delete
  const handleConfirmDelete = async () => {
    if (!deleteConfirmState.tableId) return;

    try {
      // Delete from local store
      await removeDataTable(deleteConfirmState.tableId);

      // Clear selection and close dialog
      setSelectedTableId(null);
      setDeleteConfirmState({ isOpen: false, tableId: null, tableName: null });
    } catch (error) {
      console.error("Failed to delete table:", error);
    }
  };

  if (isLoading && !dataSource) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">Loading data source…</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (!dataSource) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Data source not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The data source you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button
            label="Go to Data Sources"
            onClick={() => router.push("/data-sources")}
            className="mt-4"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <AppLayout
        headerContent={
          <div className="container mx-auto px-6 py-4">
            <div className="mb-4">
              <Breadcrumb
                LinkComponent={Link}
                items={[
                  {
                    label: (
                      <span className="flex items-center gap-1">
                        <LuArrowLeft className="h-4 w-4" />
                        Back
                      </span>
                    ),
                    href: "/data-sources",
                  },
                  { label: "Data Sources", href: "/data-sources" },
                  { label: sourceName || "Untitled Source" },
                ]}
              />
            </div>
          </div>
        }
        leftPanel={
          <div className="flex h-full flex-col">
            <div className="border-b p-4">
              <Input
                value={sourceName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Data source name"
                className="w-full"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                {getSourceTypeIcon(dataSource.type)}
                Tables
              </h3>

              {dataTables.length === 0 ? (
                <div className="py-8 text-center">
                  <TableIcon className="text-muted-foreground mx-auto mb-2 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">No tables yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {dataTables.map((table) => {
                    const fieldCount = table.fields.length;

                    return (
                      <ItemCard
                        key={table.id}
                        icon={<TableIcon className="h-4 w-4" />}
                        title={table.name}
                        subtitle={`${fieldCount} fields`}
                        onClick={() => setSelectedTableId(table.id)}
                        active={selectedTableId === table.id}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        }
      >
        {selectedTableId && tableDetails ? (
          <div className="space-y-6 p-6">
            {/* Table header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  {tableDetails.dataTable?.name}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {tableDetails.fields.length} fields •{" "}
                  {tableDetails.metrics.length} metrics
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  label="Create Insight"
                  onClick={() => handleCreateInsight(selectedTableId)}
                  icon={Plus}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      label="More options"
                      variant="text"
                      size="sm"
                      iconOnly
                      icon={LuMoreHorizontal}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleDeleteTable}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Table
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Fields */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fields</CardTitle>
              </CardHeader>
              <CardContent>
                {tableDetails.fields.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No fields defined
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {tableDetails.fields.map((field) => (
                      <div
                        key={field.id}
                        className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2"
                      >
                        <span className="text-sm font-medium">
                          {field.name}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {field.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                {tableDetails.metrics.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No metrics defined
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {tableDetails.metrics.map((metric) => (
                      <div
                        key={metric.id}
                        className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2"
                      >
                        <span className="text-sm font-medium">
                          {metric.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {metric.aggregation}
                          {metric.columnName && `(${metric.columnName})`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Data preview */}
            {dataFrameEntry && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Data Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-96 overflow-auto">
                    {(() => {
                      if (isLoadingPreview) {
                        return (
                          <div className="flex h-40 items-center justify-center">
                            <div className="flex flex-col items-center gap-2">
                              <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
                              <p className="text-muted-foreground text-sm">
                                Loading data...
                              </p>
                            </div>
                          </div>
                        );
                      }

                      if (previewData) {
                        return (
                          <VirtualTable
                            rows={previewData.rows}
                            columns={previewData.columns}
                            height={300}
                          />
                        );
                      }

                      return (
                        <div className="flex h-40 items-center justify-center">
                          <p className="text-muted-foreground text-sm">
                            No data available
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <TableIcon className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
              <h3 className="mb-2 text-lg font-semibold">Select a table</h3>
              <p className="text-muted-foreground text-sm">
                Choose a table from the sidebar to view its details
              </p>
            </div>
          </div>
        )}
      </AppLayout>

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
              label="Cancel"
              variant="outlined"
              onClick={() =>
                setDeleteConfirmState({
                  isOpen: false,
                  tableId: null,
                  tableName: null,
                })
              }
            />
            <Button
              label="Delete Table"
              color="danger"
              onClick={handleConfirmDelete}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
