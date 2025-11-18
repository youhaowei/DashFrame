"use client";

import { useState, useMemo } from "react";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { EnhancedDataFrame } from "@dash-frame/dataframe";
import { DataGrid } from "@/components/data-grid";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function DataFramesPage() {
  const dataFrames = useDataFramesStore((state) => state.getAll());
  const remove = useDataFramesStore((state) => state.remove);
  const getDataSource = useDataSourcesStore((state) => state.get);

  const [editingFrame, setEditingFrame] = useState<EnhancedDataFrame | null>(null);
  const [editedName, setEditedName] = useState("");

  const columns = useMemo<ColumnDef<EnhancedDataFrame>[]>(
    () => [
      {
        accessorKey: "metadata.name",
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
          <div className="font-medium">
            {row.original.metadata.name}
          </div>
        ),
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => {
          const dataSource = getDataSource(row.original.metadata.source.dataSourceId);
          return (
            <span className="text-muted-foreground">
              {dataSource?.name || "Unknown"}
            </span>
          );
        },
      },
      {
        id: "dimensions",
        header: "Dimensions",
        cell: ({ row }) => {
          const { rowCount, columnCount } = row.original.metadata;
          return (
            <span className="text-muted-foreground">
              {rowCount} rows × {columnCount} columns
            </span>
          );
        },
      },
      {
        accessorKey: "metadata.timestamp",
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
            {new Date(row.original.metadata.timestamp).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [getDataSource]
  );

  const handleEdit = (dataFrame: EnhancedDataFrame) => {
    setEditingFrame(dataFrame);
    setEditedName(dataFrame.metadata.name);
  };

  const handleSaveEdit = () => {
    // TODO: Implement update functionality in dataframes store
    console.log("Save edit:", editedName);
    setEditingFrame(null);
  };

  const handleDelete = (dataFrame: EnhancedDataFrame) => {
    if (confirm(`Delete "${dataFrame.metadata.name}"? This cannot be undone.`)) {
      remove(dataFrame.metadata.id);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="rounded-2xl border border-border/60 bg-card/80 px-6 py-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <h1 className="text-3xl font-bold text-foreground">Data Frames</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          View and manage processed data from your sources
        </p>
      </header>

      <section className="flex flex-1 flex-col rounded-2xl border border-border/60 bg-card/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex-1 p-6">
          <DataGrid
            data={dataFrames}
            columns={columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
            emptyMessage="No data frames yet"
            emptyDescription="Create visualizations from your data sources to generate data frames."
          />
        </div>
      </section>

      <Dialog open={!!editingFrame} onOpenChange={() => setEditingFrame(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Data Frame</DialogTitle>
            <DialogDescription>
              Update the name of this data frame.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFrame(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
