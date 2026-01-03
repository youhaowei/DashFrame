"use client";

import { useState, useMemo } from "react";
import {
  useDataFrames,
  useDataFrameMutations,
  type DataFrameEntry,
} from "@dashframe/core";
import { DataGrid } from "@/components/data-grid";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button,
  ArrowUpDownIcon,
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
  // Use Dexie hooks for reactive data
  const { data: dataFrames, isLoading } = useDataFrames();
  const mutations = useDataFrameMutations();

  const [editingFrame, setEditingFrame] = useState<DataFrameEntry | null>(null);
  const [editedName, setEditedName] = useState("");

  const columns = useMemo<ColumnDef<DataFrameEntry>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <Button
              variant="text"
              icon={ArrowUpDownIcon}
              label="Name"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
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
              variant="text"
              icon={ArrowUpDownIcon}
              label="Created"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
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

  const handleSaveEdit = async () => {
    if (editingFrame) {
      await mutations.updateMetadata(editingFrame.id, { name: editedName });
    }
    setEditingFrame(null);
  };

  const handleDelete = async (entry: DataFrameEntry) => {
    if (confirm(`Delete "${entry.name}"? This cannot be undone.`)) {
      await mutations.removeDataFrame(entry.id);
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading data frames...</p>
      </div>
    );
  }

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
            data={dataFrames ?? []}
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
            <Button
              variant="outlined"
              label="Cancel"
              onClick={() => setEditingFrame(null)}
            />
            <Button label="Save changes" onClick={handleSaveEdit} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
