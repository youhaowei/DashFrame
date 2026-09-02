import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import {
  ArtifactCard,
  ArtifactCollection,
  ArtifactEmptyState,
  ArtifactGrid,
} from "@/components/artifacts/ArtifactCollection";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useNow } from "@/hooks/useNow";
import {
  removeDataFrame,
  type DataFrameEntry,
} from "@/lib/data-access/data-frames";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@dashframe/convex-backend/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  Input,
  Label,
} from "@wystack/ui-react";
import { DeleteIcon, TableIcon } from "@wystack/ui-react/icons";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "createdAt-asc", label: "Created (oldest)" },
  { value: "createdAt-desc", label: "Created (newest)" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

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
    useQuery({ query: api.app.listDataFrames, args: { recovery: true } }),
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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortValue, setSortValue] = useState<SortValue>("name-asc");

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

  const filteredDataFrames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const [sortKey, sortDirection] = sortValue.split("-") as [
      "name" | "createdAt",
      "asc" | "desc",
    ];

    return (dataFrames ?? [])
      .filter((entry) => entry.name.toLowerCase().includes(query))
      .slice()
      .sort((left, right) => {
        const comparison =
          sortKey === "name"
            ? left.name.localeCompare(right.name)
            : left.createdAt - right.createdAt;
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [dataFrames, searchQuery, sortValue]);

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

  const renderDataFrameCard = (entry: DataFrameEntry) => {
    const sourceName = resolveSourceName(
      entry.sourceId,
      isLoadingDataSources,
      dataSourceNameById,
    );
    const definitionName = resolveDefinitionName(
      entry.definitionId,
      isLoadingDataTables,
      dataTableNameById,
    );
    const sourceDisplayName =
      sourceName ?? (entry.insightId ? "From Insight" : "Direct Load");
    const dimensions = `${entry.rowCount ?? "?"} rows × ${entry.columnCount ?? "?"} columns`;
    const lastRefreshed = entry.lastRefreshedAt
      ? formatRelativeTime(now, entry.lastRefreshedAt)
      : "—";
    const storageType = entry.storage?.type ?? "Unknown";

    return (
      <ArtifactCard
        key={entry.id}
        name={entry.name}
        icon={<TableIcon aria-hidden className="h-5 w-5" />}
        metadata={
          <>
            <span className="block">Source: {sourceDisplayName}</span>
            <span className="block">Definition: {definitionName}</span>
            <span className="block">Dimensions: {dimensions}</span>
            <span className="block">Last refreshed: {lastRefreshed}</span>
            <span className="block capitalize">Storage: {storageType}</span>
            <span className="block">
              Created: {new Date(entry.createdAt).toLocaleDateString()}
            </span>
          </>
        }
        actions={
          <DropdownMenu>
            <RoutedCardActionMenuTrigger />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleEdit(entry)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-palette-danger"
                onClick={() => handleDelete(entry)}
              >
                <DeleteIcon className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    );
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
    <ArtifactCollection
      title="Data Frames"
      description={`${dataFrames?.length ?? 0} data frame${dataFrames?.length === 1 ? "" : "s"}`}
      searchLabel="Search data frames"
      searchPlaceholder="Search data frames..."
      itemCount={dataFrames?.length ?? 0}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      tools={
        <label className="flex items-center gap-2 text-sm text-neutral-fg-subtle">
          <span>Sort</span>
          <select
            aria-label="Sort data frames"
            value={sortValue}
            onChange={(event) => setSortValue(event.target.value as SortValue)}
            className="h-9 rounded-md border border-neutral-border bg-neutral-bg px-2 text-sm text-neutral-fg"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {filteredDataFrames.length > 0 ? (
        <ArtifactGrid>
          {filteredDataFrames.map(renderDataFrameCard)}
        </ArtifactGrid>
      ) : (
        <ArtifactEmptyState
          title={
            searchQuery.trim() ? "No data frames found" : "No data frames yet"
          }
          description={
            searchQuery.trim()
              ? `No data frames match "${searchQuery}"`
              : "Create visualizations from your data sources to generate data frames."
          }
          action={
            searchQuery.trim() ? (
              <Button
                variant="outline"
                label="Clear search"
                onClick={() => setSearchQuery("")}
              />
            ) : undefined
          }
        />
      )}

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
    </ArtifactCollection>
  );
}
