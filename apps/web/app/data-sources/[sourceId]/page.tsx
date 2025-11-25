"use client";

import { use, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@dashframe/convex";
import type { Id, Doc } from "@dashframe/convex/dataModel";
import {
  Button,
  Input,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Trash2,
  Database,
  TableIcon,
  Plus,
} from "@dashframe/ui";
import { LuArrowLeft, LuLoader, LuFileSpreadsheet, LuCloud } from "react-icons/lu";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { DataFrameTable } from "@dashframe/ui";

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

// Get label for data source type
function getSourceTypeLabel(type: string) {
  switch (type) {
    case "notion":
      return "Notion Database";
    case "local":
      return "Uploaded CSV";
    case "postgresql":
      return "PostgreSQL";
    default:
      return "Unknown";
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

  // Convex queries
  const dataSourceWithTables = useQuery(api.dataSources.getWithTables, {
    id: sourceId as Id<"dataSources">,
  });

  // Local state for selected table
  const [selectedTableId, setSelectedTableId] = useState<Id<"dataTables"> | null>(null);

  // Query selected table details (fields and metrics)
  const tableDetails = useQuery(
    api.dataTables.getWithFieldsAndMetrics,
    selectedTableId ? { id: selectedTableId } : "skip"
  );

  // Convex mutations
  const updateDataSource = useMutation(api.dataSources.update);
  const removeDataSource = useMutation(api.dataSources.remove);

  // DataFrames store for preview data
  const getDataFrame = useDataFramesStore((state) => state.get);

  // Local state
  const [sourceName, setSourceName] = useState("");

  // Auto-select first table when data loads
  useEffect(() => {
    if (dataSourceWithTables?.dataTables && dataSourceWithTables.dataTables.length > 0 && !selectedTableId) {
      setSelectedTableId(dataSourceWithTables.dataTables[0]._id);
    }
  }, [dataSourceWithTables?.dataTables, selectedTableId]);

  // Sync source name when data loads
  useEffect(() => {
    if (dataSourceWithTables?.dataSource?.name) {
      setSourceName(dataSourceWithTables.dataSource.name);
    }
  }, [dataSourceWithTables?.dataSource?.name]);

  // Get DataFrame for selected table preview
  const dataFrame = useMemo(() => {
    if (!tableDetails?.dataTable?.dataFrameId) return null;
    return getDataFrame(tableDetails.dataTable.dataFrameId);
  }, [tableDetails?.dataTable?.dataFrameId, getDataFrame]);

  // Handle name change
  const handleNameChange = async (newName: string) => {
    setSourceName(newName);
    await updateDataSource({
      id: sourceId as Id<"dataSources">,
      name: newName,
    });
  };

  // Handle delete
  const handleDelete = async () => {
    if (
      confirm(
        `Are you sure you want to delete "${dataSourceWithTables?.dataSource?.name}"? This will also delete all tables, insights, and visualizations associated with it.`
      )
    ) {
      await removeDataSource({ id: sourceId as Id<"dataSources"> });
      router.push("/data-sources");
    }
  };

  // Handle create insight from table
  const handleCreateInsight = (tableId: Id<"dataTables">) => {
    // Navigate to insights page with pre-selected table
    // The actual insight creation will happen there
    router.push(`/insights?newInsight=true&tableId=${tableId}`);
  };

  // Loading state
  if (dataSourceWithTables === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading data source...</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (dataSourceWithTables === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Data source not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The data source you're looking for doesn't exist.
          </p>
          <Button onClick={() => router.push("/data-sources")} className="mt-4">
            Go to Data Sources
          </Button>
        </div>
      </div>
    );
  }

  const { dataSource, dataTables } = dataSourceWithTables;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/data-sources")}
            >
              <LuArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex-1 min-w-[220px]">
              <Input
                value={sourceName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Data source name"
                className="w-full"
              />
            </div>
            <Badge variant="secondary">
              {getSourceTypeLabel(dataSource.type)}
            </Badge>
          </div>

          {/* Metadata row */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{dataTables.length} table{dataTables.length !== 1 ? "s" : ""}</span>
              <span>•</span>
              <span>
                Created{" "}
                {new Date(dataSource.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete Source
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tables sidebar */}
        <aside className="w-72 border-r bg-card overflow-y-auto">
          <div className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              {getSourceTypeIcon(dataSource.type)}
              Tables
            </h3>

            {dataTables.length === 0 ? (
              <div className="text-center py-8">
                <TableIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No tables yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dataTables.map((table: Doc<"dataTables">) => (
                  <Card
                    key={table._id}
                    className={`cursor-pointer transition-colors ${
                      selectedTableId === table._id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedTableId(table._id)}
                  >
                    <CardContent className="p-3">
                      <p className="font-medium text-sm truncate">{table.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {table.sourceSchema?.fields?.length || 0} fields
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {selectedTableId && tableDetails ? (
            <div className="p-6 space-y-6">
              {/* Table header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    {tableDetails.dataTable?.name}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {tableDetails.fields.length} fields •{" "}
                    {tableDetails.metrics.length} metrics
                  </p>
                </div>
                <Button onClick={() => handleCreateInsight(selectedTableId)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Insight
                </Button>
              </div>

              {/* Fields */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Fields</CardTitle>
                </CardHeader>
                <CardContent>
                  {tableDetails.fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No fields defined</p>
                  ) : (
                    <div className="grid gap-2">
                      {tableDetails.fields.map((field: Doc<"fields">) => (
                        <div
                          key={field._id}
                          className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg"
                        >
                          <span className="text-sm font-medium">{field.name}</span>
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
                    <p className="text-sm text-muted-foreground">No metrics defined</p>
                  ) : (
                    <div className="grid gap-2">
                      {tableDetails.metrics.map((metric: Doc<"metrics">) => (
                        <div
                          key={metric._id}
                          className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg"
                        >
                          <span className="text-sm font-medium">{metric.name}</span>
                          <Badge variant="secondary" className="text-xs font-mono">
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
              {dataFrame && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Data Preview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-96 overflow-auto">
                      <DataFrameTable dataFrame={dataFrame.data} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <TableIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Select a table</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a table from the sidebar to view its details
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
