"use client";

import { useState, useMemo } from "react";
import {
  useDataFramesStore,
  type DataFrameEntry,
} from "@/lib/stores/dataframes-store";
import { DataGrid } from "@/components/data-grid";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button,
  ArrowUpDown,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@dashframe/ui";

export default function DataFramesPage() {
  // Inline state access so Zustand can track dependencies properly
  const dataFrames = useDataFramesStore((state) => state.getAllEntries());
  const removeDataFrame = useDataFramesStore((state) => state.removeDataFrame);
  const updateMetadata = useDataFramesStore((state) => state.updateMetadata);

  const [editingFrame, setEditingFrame] = useState<DataFrameEntry | null>(null);
  const [editedName, setEditedName] = useState("");

  const columns = useMemo<ColumnDef<DataFrameEntry>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              Name
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <div className="font-medium">{row.original.name}</div>
        ),
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => {
          return (
            <span className="text-muted-foreground">
              {row.original.insightId ? "From Insight" : "Direct Load"}
            </span>
          );
        },
      },
      {
        id: "dimensions",
        header: "Dimensions",
        cell: ({ row }) => {
          const { rowCount, columnCount } = row.original;
          return (
            <span className="text-muted-foreground">
              {rowCount ?? "?"} rows × {columnCount ?? "?"} columns
            </span>
          );
        },
      },
      {
        id: "storage",
        header: "Storage",
        cell: ({ row }) => {
          const storageType = row.original.storage?.type;
          return (
            <span className="text-muted-foreground capitalize">
              {storageType === "indexeddb"
                ? "Browser"
                : (storageType ?? "Unknown")}
            </span>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              Created
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [],
  );

  const handleEdit = (entry: DataFrameEntry) => {
    setEditingFrame(entry);
    setEditedName(entry.name);
  };

  const handleSaveEdit = () => {
    if (editingFrame) {
      updateMetadata(editingFrame.id, { name: editedName });
    }
    setEditingFrame(null);
  };

  const handleDelete = (entry: DataFrameEntry) => {
    if (confirm(`Delete "${entry.name}"? This cannot be undone.`)) {
      // Note: removeDataFrame is async but we don't need to await it for UI purposes
      void removeDataFrame(entry.id);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="border-border/60 bg-card/80 supports-[backdrop-filter]:bg-card/60 rounded-2xl border px-6 py-6 shadow-sm backdrop-blur">
        <h1 className="text-foreground text-3xl font-bold">Data Frames</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          View and manage processed data from your sources
        </p>
      </header>

      <section className="border-border/60 bg-card/80 supports-[backdrop-filter]:bg-card/60 flex flex-1 flex-col rounded-2xl border shadow-lg backdrop-blur">
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
