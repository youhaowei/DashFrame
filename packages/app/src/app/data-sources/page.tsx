import { ConnectorIcon } from "@/components/data-sources/renderers/ConnectorIcon";
import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import {
  ArtifactCollection,
  ArtifactGrid,
  ArtifactEmptyState,
  ArtifactCard,
} from "@/components/artifacts/ArtifactCollection";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";
import {
  getConnectorById,
  useRegistryVersion,
} from "@/lib/connectors/registry";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@/wystack/api";
import { cmd, type DataSource, type UUID } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@wystack/client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  ErrorState,
} from "@wystack/ui-react";
import {
  DatabaseIcon,
  DeleteIcon,
  ExternalLinkIcon,
  PlusIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

// Type for data source with table count
type DataSourceWithTables = {
  dataSource: DataSource;
  tableCount: number;
};

/**
 * Data Sources Management Page
 *
 * Shows all data sources with their table counts.
 * Click a data source to see its tables and details.
 */
export default function DataSourcesPage() {
  const navigate = useNavigate();

  // Subscribe so a re-render fires once the connector registry hydrates from
  // the server catalog (getConnectorById reads a module-scope map, which is
  // not reactive on its own).
  useRegistryVersion();

  const dataSourcesQuery = useQuery(api.listDataSources);
  const dataSources = dataSourcesQuery.data;
  const refetchDataSources = dataSourcesQuery.refetch;
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);
  const { confirm } = useConfirmDialogStore();

  // Get all data tables to count them per source
  const dataTablesQuery = useQuery(api.listDataTables, { args: {} });
  const allDataTables = dataTablesQuery.data;
  const refetchDataTables = dataTablesQuery.refetch;

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const handleRetry = useCallback(async () => {
    await Promise.all([refetchDataSources(), refetchDataTables()]);
  }, [refetchDataSources, refetchDataTables]);

  // Transform data sources for display
  const allDataSources = useMemo((): DataSourceWithTables[] => {
    return (dataSources ?? []).map((source) => {
      const tableCount = (allDataTables ?? []).filter(
        (table) => table.dataSourceId === source.id,
      ).length;
      return {
        dataSource: source,
        tableCount,
      };
    });
  }, [dataSources, allDataTables]);

  // Filter data sources by search query
  const filteredDataSources = useMemo(() => {
    if (!searchQuery.trim()) return allDataSources;
    const query = searchQuery.toLowerCase();
    return allDataSources.filter(
      (item) =>
        item.dataSource.name.toLowerCase().includes(query) ||
        item.dataSource.type.toLowerCase().includes(query),
    );
  }, [allDataSources, searchQuery]);

  // Resolve icon and label from the connector registry.
  // Falls back gracefully for unregistered kinds (e.g. postgresql not yet
  // registered) — adding a connector kind and registering it is all that's
  // needed to make it appear with the correct icon/label everywhere.
  const getTypeIcon = (type: string) => {
    const connector = getConnectorById(type);
    if (!connector) return <DatabaseIcon className="h-5 w-5" />;
    return <ConnectorIcon svg={connector.icon} className="h-5 w-5" />;
  };

  const getTypeLabel = (type: string) => {
    return getConnectorById(type)?.name ?? type;
  };

  // Handle delete data source
  const handleDeleteDataSource = async (
    dataSourceId: UUID,
    dataSourceName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    confirm({
      title: "Delete data source",
      description: `Are you sure you want to delete "${dataSourceName}"? This deletes the data source and its data tables. Related DataFrame metadata and storage, and dependent insights, may remain. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await commitBatch({
            commands: [cmd("DeleteNode", { id: dataSourceId })],
          });
        } catch {
          toast.error("Failed to delete data source");
        }
      },
    });
  };

  const renderDataSourceCard = (item: DataSourceWithTables) => (
    <ArtifactCard
      key={item.dataSource.id}
      to={`/data-sources/${item.dataSource.id}`}
      name={item.dataSource.name}
      icon={getTypeIcon(item.dataSource.type)}
      metadata={
        <>
          {getTypeLabel(item.dataSource.type)} <span aria-hidden="true">·</span>{" "}
          <TableIcon aria-hidden className="mr-1 inline h-3 w-3" />
          {item.tableCount} table{item.tableCount !== 1 ? "s" : ""}
        </>
      }
      actions={
        <DropdownMenu>
          <RoutedCardActionMenuTrigger />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                navigate({
                  to: `/data-sources/${item.dataSource.id}`,
                } as never);
              }}
            >
              <ExternalLinkIcon className="mr-2 h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-palette-danger"
              onClick={(e) =>
                handleDeleteDataSource(
                  item.dataSource.id,
                  item.dataSource.name,
                  e as unknown as React.MouseEvent,
                )
              }
            >
              <DeleteIcon className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );

  const isInitialLoading =
    (dataSourcesQuery.isLoading && dataSourcesQuery.data === undefined) ||
    (dataTablesQuery.isLoading && dataTablesQuery.data === undefined);
  const hasInitialError =
    (dataSourcesQuery.isError && dataSourcesQuery.data === undefined) ||
    (dataTablesQuery.isError && dataTablesQuery.data === undefined);

  if (isInitialLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading data sources…</p>
      </div>
    );
  }

  if (hasInitialError) {
    return (
      <ErrorState
        title="Failed to load data sources"
        description="DashFrame could not reach the data service. Check that the server is running, then retry."
        retryAction={{ label: "Retry", onClick: handleRetry }}
        className="h-full"
      />
    );
  }

  return (
    <ArtifactCollection
      title="Data Sources"
      description={
        <>
          {allDataSources.length} source
          {allDataSources.length !== 1 ? "s" : ""}
        </>
      }
      actions={
        <Button
          icon={PlusIcon}
          label="Add Source"
          onClick={() => setIsCreateModalOpen(true)}
        />
      }
      searchLabel="Search data sources"
      searchPlaceholder="Search data sources..."
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      {filteredDataSources.length > 0 ? (
        <ArtifactGrid>
          {filteredDataSources.map(renderDataSourceCard)}
        </ArtifactGrid>
      ) : (
        <ArtifactEmptyState
          title={searchQuery ? "No data sources found" : "No data sources yet"}
          description={
            searchQuery
              ? `No data sources match "${searchQuery}"`
              : "Connect your first data source to start analyzing"
          }
          action={
            searchQuery ? (
              <Button
                variant="outline"
                label="Clear search"
                onClick={() => setSearchQuery("")}
              />
            ) : (
              <Button
                icon={PlusIcon}
                label="Add Source"
                onClick={() => setIsCreateModalOpen(true)}
              />
            )
          }
        />
      )}

      {/* Create Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Add Data Source"
      />
    </ArtifactCollection>
  );
}
