import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { ConnectorIcon } from "@/components/data-sources/renderers/ConnectorIcon";
import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import {
  ArtifactCollection,
  ArtifactGrid,
  ArtifactEmptyState,
  ArtifactRow,
  ArtifactRowGroups,
  ArtifactRowOpen,
  ArtifactTile,
  type ArtifactRowPlacement,
} from "@/components/artifacts/ArtifactCollection";
import { groupByKey } from "@/components/artifacts/collection-groups";
import { useNow } from "@/hooks/useNow";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { useCollectionView, useShellStore } from "@/lib/stores/shell-store";
import { sourceFreshness } from "./source-freshness";
import { AddDataSourceModal } from "@/components/data-sources/AddDataSourceModal";
import {
  getConnectorById,
  useRegistryVersion,
} from "@/lib/connectors/registry";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@dashframe/convex-backend/api";
import { cmd, type DataSource, type UUID } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";

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
} from "@wystack/ui-react/icons";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

type DataSourceWithTables = {
  dataSource: DataSource;
  tableCount: number;
  /** Fetch times of the source's tables that have been fetched. */
  fetchTimes: number[];
};

function tableCountLabel(count: number) {
  return `${count} table${count === 1 ? "" : "s"}`;
}

function freshnessOf(item: DataSourceWithTables) {
  return sourceFreshness(
    item.fetchTimes,
    getConnectorById(item.dataSource.type)?.sourceType,
  );
}

/** "Is it current?": "refreshed 2h ago", "imported 5d ago", or just "2h ago". */
function fetchedLabel(item: DataSourceWithTables, now: number) {
  const freshness = freshnessOf(item);
  if (!freshness) return undefined;
  const time = formatRelativeTime(now, freshness.at);
  return freshness.verb ? `${freshness.verb} ${time}` : time;
}

// Resolve icon and label from the connector registry.
// Falls back gracefully for unregistered kinds (e.g. postgresql not yet
// registered) — adding a connector kind and registering it is all that's
// needed to make it appear with the correct icon/label everywhere.
// Marks stay neutral: brand colour on every tile would outshout the names.
function getTypeIcon(type: string, className = "h-6 w-6") {
  const connector = getConnectorById(type);
  if (!connector) return <DatabaseIcon className={className} />;
  return (
    <ConnectorIcon svg={connector.icon} className={`${className} grayscale`} />
  );
}

function getTypeLabel(type: string) {
  return getConnectorById(type)?.name ?? type;
}

/**
 * Data Sources Management Page
 *
 * Shows all data sources with their table counts.
 * Click a data source to see its tables and details.
 */
interface DataSourcesPageProps {
  /**
   * Whether the Add data source dialog is open. The route keeps it in the URL,
   * so the command palette can open it by navigating here.
   */
  addSourceOpen: boolean;
  onAddSourceOpenChange: (open: boolean) => void;
}

export default function DataSourcesPage({
  addSourceOpen: isAddSourceOpen,
  onAddSourceOpenChange: setIsAddSourceOpen,
}: DataSourcesPageProps) {
  const navigate = useNavigate();

  // Subscribe so a re-render fires once the connector registry hydrates from
  // the server catalog (getConnectorById reads a module-scope map, which is
  // not reactive on its own).
  useRegistryVersion();

  const dataSourcesQuery = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const dataSources = dataSourcesQuery.data;
  const commitBatch = useMutation(api.app.commitBatch);
  const { confirm } = useConfirmDialogStore();

  // Get all data tables to count them per source
  const dataTablesQuery = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const allDataTables = dataTablesQuery.data;

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const view = useCollectionView("data-source");
  const setCollectionView = useShellStore((state) => state.setCollectionView);
  const now = useNow();

  const handleRetry = useCallback(() => globalThis.location.reload(), []);

  // Transform data sources for display
  const allDataSources = useMemo((): DataSourceWithTables[] => {
    return (dataSources ?? []).map((source) => {
      const tables = (allDataTables ?? []).filter(
        (table) => table.dataSourceId === source.id,
      );
      return {
        dataSource: source,
        tableCount: tables.length,
        fetchTimes: tables.flatMap((table) =>
          table.lastFetchedAt ? [table.lastFetchedAt] : [],
        ),
      };
    });
  }, [dataSources, allDataTables]);

  // Search names and the provider, by id or by its display name.
  const query = searchQuery.trim().toLowerCase();
  const filteredDataSources = query
    ? allDataSources.filter(
        (item) =>
          item.dataSource.name.toLowerCase().includes(query) ||
          item.dataSource.type.toLowerCase().includes(query) ||
          getTypeLabel(item.dataSource.type).toLowerCase().includes(query),
      )
    : allDataSources;

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

  const renderDataSourceMenu = (item: DataSourceWithTables) => (
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
  );

  const renderDataSourceTile = (item: DataSourceWithTables) => {
    const fetched = fetchedLabel(item, now);
    return (
      <ArtifactTile
        key={item.dataSource.id}
        to={`/data-sources/${item.dataSource.id}`}
        name={item.dataSource.name}
        glyph={getTypeIcon(item.dataSource.type)}
        meta={[
          getTypeLabel(item.dataSource.type),
          tableCountLabel(item.tableCount),
          fetched,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={renderDataSourceMenu(item)}
      />
    );
  };

  // Under a provider label the row drops the provider name; the flat list
  // (one provider) keeps it, since nothing else on the row names it. The row's
  // time is the same freshness the tile names, without the verb.
  const renderDataSourceRow = (
    item: DataSourceWithTables,
    { grouped, headingLevel }: ArtifactRowPlacement,
  ) => {
    const freshness = freshnessOf(item);
    return (
      <ArtifactRow
        key={item.dataSource.id}
        to={`/data-sources/${item.dataSource.id}`}
        headingLevel={headingLevel}
        glyph={getTypeIcon(item.dataSource.type, "h-4 w-4")}
        name={item.dataSource.name}
        meta={
          grouped
            ? tableCountLabel(item.tableCount)
            : `${getTypeLabel(item.dataSource.type)} · ${tableCountLabel(item.tableCount)}`
        }
        time={freshness && formatRelativeTime(now, freshness.at)}
        actions={
          <>
            <ArtifactRowOpen to={`/data-sources/${item.dataSource.id}`} />
            {renderDataSourceMenu(item)}
          </>
        }
      />
    );
  };

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

  const populated =
    view === "list" ? (
      <ArtifactRowGroups
        groups={groupByKey(
          filteredDataSources,
          (item) => item.dataSource.type,
          getTypeLabel,
        )}
        renderRow={renderDataSourceRow}
      />
    ) : (
      <ArtifactGrid compact>
        {filteredDataSources.map(renderDataSourceTile)}
      </ArtifactGrid>
    );

  return (
    <ArtifactCollection
      title="Data Sources"
      count={allDataSources.length}
      actions={
        <Button
          icon={PlusIcon}
          label="Add Source"
          onClick={() => setIsAddSourceOpen(true)}
        />
      }
      searchLabel="Search data sources"
      searchPlaceholder="Search data sources..."
      itemCount={allDataSources.length}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      view={view}
      onViewChange={(next) => setCollectionView("data-source", next)}
    >
      {filteredDataSources.length > 0 ? (
        populated
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
                onClick={() => setIsAddSourceOpen(true)}
              />
            )
          }
        />
      )}

      {/* Add Source dialog */}
      <AddDataSourceModal
        isOpen={isAddSourceOpen}
        onClose={() => setIsAddSourceOpen(false)}
      />
    </ArtifactCollection>
  );
}
