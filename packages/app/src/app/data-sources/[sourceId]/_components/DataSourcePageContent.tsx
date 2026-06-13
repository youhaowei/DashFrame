import {
  type ArtifactContextValue,
  useBindArtifact,
} from "@/components/assistant/artifact-context";
import { ConnectorIcon } from "@/components/data-sources/renderers/ConnectorIcon";
import { SensitivityBadge } from "@/components/data-sources/SensitivityBadge";
import { AppLayout } from "@/components/layouts/AppLayout";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { getConnectorById } from "@/lib/connectors/registry";
import { PerfStage, withPerfAsync } from "@/lib/perf";
import {
  useDataFrames,
  useDataSourceMutations,
  useDataSources,
  useDataTableMutations,
  useDataTables,
} from "@dashframe/core";
import { extractUUIDFromColumnAlias } from "@dashframe/engine";
import type { ColumnAnalysis, FieldSensitivity, UUID } from "@dashframe/types";
import {
  buildSensitivityUpdate,
  getFieldSensitivity,
  suggestSensitivityReasons,
} from "@dashframe/types";
import { Breadcrumb, VirtualTable } from "@dashframe/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  Input,
  ItemCard,
} from "@wystack/ui";
import {
  DatabaseIcon,
  DeleteIcon,
  ChevronLeftIcon as LuArrowLeft,
  MoreIcon as LuMoreHorizontal,
  PlusIcon,
  TableIcon,
} from "@wystack/ui-icons";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface DataSourcePageContentProps {
  sourceId: string;
}

const SENSITIVITY_TOASTS: Record<FieldSensitivity, string> = {
  sensitive: "Field marked sensitive",
  cleared: "Field marked as not sensitive",
  unclassified: "Field reset to unclassified",
};

// Get icon for a data source type, driven by the connector registry.
// Renders the connector's own icon; falls back to a generic database glyph.
function getSourceTypeIcon(type: string) {
  const connector = getConnectorById(type);
  if (connector) {
    return <ConnectorIcon svg={connector.icon} className="h-5 w-5" />;
  }
  return <DatabaseIcon className="h-5 w-5" />;
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
/**
 * Builds the assistant's artifact binding for a data source, memoized so the
 * binding effect only fires on a real change. Returns null until the source
 * loads.
 */
function useDataSourceArtifact(
  dataSource: unknown,
  sourceId: string,
  sourceName: string,
  tableCount: number,
): ArtifactContextValue | null {
  return useMemo(() => {
    if (!dataSource) return null;
    const unit = tableCount === 1 ? "table" : "tables";
    const subtitle = tableCount > 0 ? `${tableCount} ${unit}` : undefined;
    return {
      kind: "data-source",
      id: sourceId,
      title: sourceName || "Untitled source",
      subtitle,
    };
  }, [dataSource, sourceId, sourceName, tableCount]);
}

export default function DataSourcePageContent({
  sourceId,
}: DataSourcePageContentProps) {
  const navigate = useNavigate();

  // Dexie hooks
  const { data: allDataSources = [] } = useDataSources();
  const { update: updateDataSource } = useDataSourceMutations();
  const { remove: removeDataTable, updateField } = useDataTableMutations();
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

  // Bind the assistant to this data source so its sidebar is contextual to what
  // the user is looking at. Cleared automatically on unmount.
  useBindArtifact(
    useDataSourceArtifact(dataSource, sourceId, sourceName, dataTables.length),
  );

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
    // Command-apply boundary: a direct mutation on the artifact. Instrumented so
    // the dev HUD can hold it against the <100ms perceived budget. Wrapped so a
    // failed mutation surfaces a toast instead of rejecting out of the input
    // event path (unhandled rejection).
    try {
      await withPerfAsync(
        PerfStage.CommandApply,
        () => updateDataSource(sourceId, { name: newName }),
        `data-source:${sourceId}`,
      );
    } catch {
      toast.error("Failed to rename data source");
    }
  };

  // Handle create insight from table
  const handleCreateInsight = (tableId: UUID) => {
    // Navigate to insights page with pre-selected table
    // The actual insight creation will happen there
    navigate({
      to: "/insights",
      search: { newInsight: "true", tableId },
    } as never);
  };

  // Cached column analysis keyed by field ID, for data-driven sensitivity
  // signals (email-shaped values, free text) beyond name heuristics.
  const analysisByFieldId = useMemo(() => {
    const map = new Map<string, ColumnAnalysis>();
    for (const column of dataFrameEntry?.analysis?.columns ?? []) {
      const fieldId =
        column.fieldId ?? extractUUIDFromColumnAlias(column.columnName);
      if (fieldId) map.set(fieldId, column);
    }
    return map;
  }, [dataFrameEntry]);

  // One-click sensitivity marking. Confirming a classifier suggestion keeps
  // its reasons; deliberate marking/clearing is recorded as a user decision.
  const handleSetFieldSensitivity = async (
    fieldId: UUID,
    sensitivity: FieldSensitivity,
    reasons?: string[],
  ) => {
    if (!effectiveSelectedTableId) return;
    try {
      await updateField(
        effectiveSelectedTableId,
        fieldId,
        buildSensitivityUpdate(sensitivity, reasons),
      );
    } catch {
      toast.error("Failed to update field sensitivity");
      return;
    }
    toast.success(SENSITIVITY_TOASTS[sensitivity]);
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
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-neutral-fg-subtle">Loading data source…</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (!dataSource) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Data source not found</h2>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            The data source you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button
            label="Go to Data Sources"
            onClick={() => navigate({ to: "/data-sources" })}
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
                    to: "/data-sources",
                  },
                  { label: "Data Sources", to: "/data-sources" },
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
                  <TableIcon className="mx-auto mb-2 h-8 w-8 text-neutral-fg-subtle" />
                  <p className="text-sm text-neutral-fg-subtle">
                    No tables yet
                  </p>
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
                <p className="mt-1 text-sm text-neutral-fg-subtle">
                  {tableDetails.fields.length} fields •{" "}
                  {tableDetails.metrics.length} metrics
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  label="Create Insight"
                  onClick={() => handleCreateInsight(selectedTableId)}
                  icon={PlusIcon}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        label="More options"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={LuMoreHorizontal}
                      />
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleDeleteTable}
                      className="text-palette-danger focus:text-palette-danger"
                    >
                      <DeleteIcon className="mr-2 h-4 w-4" />
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
                  <p className="text-sm text-neutral-fg-subtle">
                    No fields defined
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {tableDetails.fields.map((field) => {
                      const sensitivity = getFieldSensitivity(field);
                      const suggestedReasons =
                        sensitivity === "unclassified"
                          ? suggestSensitivityReasons({
                              name: field.name,
                              analysis: analysisByFieldId.get(field.id),
                            })
                          : [];

                      return (
                        <div
                          key={field.id}
                          className="flex items-center justify-between rounded-lg bg-neutral-bg-muted/30 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-sm font-medium">
                              {field.name}
                            </span>
                            <SensitivityBadge
                              field={field}
                              suggestedReasons={suggestedReasons}
                              onConfirmSuggestion={() =>
                                handleSetFieldSensitivity(
                                  field.id,
                                  "sensitive",
                                  suggestedReasons,
                                )
                              }
                            />
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {sensitivity === "cleared" ? (
                              <Button
                                label="Mark sensitive"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleSetFieldSensitivity(
                                    field.id,
                                    "sensitive",
                                  )
                                }
                                className="h-7"
                              />
                            ) : (
                              <Button
                                label="Mark safe"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleSetFieldSensitivity(field.id, "cleared")
                                }
                                className="h-7"
                              />
                            )}
                            <Badge variant="outline" className="text-xs">
                              {field.type}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
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
                  <p className="text-sm text-neutral-fg-subtle">
                    No metrics defined
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {tableDetails.metrics.map((metric) => (
                      <div
                        key={metric.id}
                        className="flex items-center justify-between rounded-lg bg-neutral-bg-muted/30 px-3 py-2"
                      >
                        <span className="text-sm font-medium">
                          {metric.name}
                        </span>
                        <Badge variant="soft" className="font-mono text-xs">
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
                              <p className="text-sm text-neutral-fg-subtle">
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
                          <p className="text-sm text-neutral-fg-subtle">
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
              <TableIcon className="mx-auto mb-4 h-12 w-12 text-neutral-fg-subtle" />
              <h3 className="mb-2 text-lg font-semibold">Select a table</h3>
              <p className="text-sm text-neutral-fg-subtle">
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
              variant="outline"
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
