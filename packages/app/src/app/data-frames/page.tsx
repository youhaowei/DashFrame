import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { DataGrid } from "@/components/data-grid";
import { useNow } from "@/hooks/useNow";
import {
  removeDataFrame,
  type DataFrameEntry,
} from "@/lib/data-access/data-frames";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@dashframe/convex-backend/api";
import type { ColumnDef } from "@tanstack/react-table";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@wystack/ui-react";
import { ArrowUpDownIcon } from "@wystack/ui-react/icons";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function resolveSourceName(
  sourceId: string | undefined,
  isLoadingDataSources: boolean,
  dataSourceNameById: Map<string, string>,
): string | null {
  if (!sourceId) return null;
  if (isLoadingDataSources) return "…";
  return dataSourceNameById.get(sourceId) ?? "Unknown source";
}

function resolveDefinitionName(
  definitionId: string | undefined,
  isLoadingDataTables: boolean,
  dataTableNameById: Map<string, string>,
): string {
  if (!definitionId) return "—";
  if (isLoadingDataTables) return "…";
  return dataTableNameById.get(definitionId) ?? "Unknown table";
}

export default function DataFramesPage() {
  const { data: dataFrames, isLoading } = queryStatus(
    useQuery({ query: api.app.listDataFrames, args: {} }),
  );
  const { data: dataSources, isLoading: isLoadingDataSources } = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const { data: dataTables, isLoading: isLoadingDataTables } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const updateDataFrameEntry = useMutation(api.app.updateDataFrameEntry);
  const { confirm } = useConfirmDialogStore();

  const [editingFrame, setEditingFrame] = useState<DataFrameEntry | null>(null);
  const [editedName, setEditedName] = useState("");

  const now = useNow();

  const dataSourceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const source of dataSources ?? []) map.set(source.id, source.name);
    return map;
  }, [dataSources]);

  const dataTableNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const table of dataTables ?? []) map.set(table.id, table.name);
    return map;
  }, [dataTables]);

  const columns = useMemo<ColumnDef<DataFrameEntry>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
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
          const { sourceId, insightId } = row.original;
          const sourceName = resolveSourceName(
            sourceId,
            isLoadingDataSources,
            dataSourceNameById,
          );
          return (
            <span className="text-neutral-fg-subtle">
              {sourceName ?? (insightId ? "From Insight" : "Direct Load")}
            </span>
          );
        },
      },
      {
        id: "definition",
        header: "Definition",
        cell: ({ row }) => {
          const { definitionId } = row.original;
          return (
            <span className="text-neutral-fg-subtle">
              {resolveDefinitionName(
                definitionId,
                isLoadingDataTables,
                dataTableNameById,
              )}
            </span>
          );
        },
      },
      {
        id: "lastRefreshedAt",
        header: "Last Refreshed",
        cell: ({ row }) => {
          const { lastRefreshedAt } = row.original;
          return (
            <span className="text-neutral-fg-subtle">
              {lastRefreshedAt ? formatRelativeTime(now, lastRefreshedAt) : "—"}
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
            <span className="text-neutral-fg-subtle">
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
            <span className="text-neutral-fg-subtle capitalize">
              {storageType ?? "Unknown"}
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
              icon={ArrowUpDownIcon}
              label="Created"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
          );
        },
        cell: ({ row }) => (
          <span className="text-neutral-fg-subtle">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [
      dataSourceNameById,
      dataTableNameById,
      now,
      isLoadingDataSources,
      isLoadingDataTables,
    ],
  );

  const handleEdit = (entry: DataFrameEntry) => {
    setEditingFrame(entry);
    setEditedName(entry.name);
  };

  const handleSaveEdit = async () => {
    if (editingFrame) {
      await updateDataFrameEntry({
        id: editingFrame.id,
        updates: { name: editedName },
      });
    }
    setEditingFrame(null);
  };

  const handleDelete = (entry: DataFrameEntry) => {
    confirm({
      title: "Delete data frame",
      description: `Are you sure you want to delete "${entry.name}"? Data tables that reference it may remain and stop working; dependent insights and visualizations may also stop working. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await removeDataFrame(entry.id);
        } catch {
          toast.error("Couldn't delete the data frame");
        }
      },
    });
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-neutral-fg-subtle">Loading data frames...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="rounded-2xl border border-neutral-border/60 bg-neutral-bg/80 px-6 py-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-neutral-bg/60">
        <h1 className="text-3xl font-bold text-neutral-fg">Data Frames</h1>
        <p className="mt-2 text-sm text-neutral-fg-subtle">
          View and manage processed data from your sources
        </p>
      </header>

      <section className="flex flex-1 flex-col rounded-2xl border border-neutral-border/60 bg-neutral-bg/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-neutral-bg/60">
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
              variant="outline"
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
