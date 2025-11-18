"use client";

import { useMemo } from "react";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { DataSource } from "@/lib/stores/types";
import { DataGrid } from "@/components/data-grid";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";

export default function DataSourcesPage() {
  const dataSources = useDataSourcesStore((state) => state.getAll());
  const remove = useDataSourcesStore((state) => state.remove);

  const columns = useMemo<ColumnDef<DataSource>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Name
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <div className="font-medium">{row.getValue("name")}</div>
        ),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => {
          const type = row.getValue("type") as string;
          return (
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                type === "csv"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-purple-100 text-purple-800"
              }`}
            >
              {type.toUpperCase()}
            </span>
          );
        },
      },
      {
        id: "insights",
        header: "Insights",
        cell: ({ row }) => {
          const dataSource = row.original;
          const insightCount = dataSource.insights ? dataSource.insights.size : 0;
          return <span className="text-muted-foreground">{insightCount}</span>;
        },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Created
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {new Date(row.getValue("createdAt")).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  );

  const handleDelete = (dataSource: DataSource) => {
    if (confirm(`Delete "${dataSource.name}"? This will also delete associated insights and data frames.`)) {
      remove(dataSource.id);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold text-foreground">Data Sources</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your CSV files and external data connections
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-7xl">
          <DataGrid
            data={dataSources}
            columns={columns}
            onDelete={handleDelete}
            emptyMessage="No data sources yet"
            emptyDescription="Upload a CSV or connect to Notion to get started."
          />
        </div>
      </main>
    </div>
  );
}
