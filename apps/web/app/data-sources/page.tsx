"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useDataSources,
  useDataSourceMutations,
  useDataTables,
} from "@dashframe/core";
import type { DataSource, UUID } from "@dashframe/types";
import {
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  DatabaseIcon,
  TableIcon,
  PlusIcon,
  DeleteIcon,
  MoreIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashframe/ui";
import {
  SearchIcon,
  ExternalLinkIcon,
  CloudIcon,
  SpreadsheetIcon,
} from "@dashframe/ui/icons";
import { CreateVisualizationModal } from "@/components/visualizations/CreateVisualizationModal";

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
  const router = useRouter();

  // Dexie hooks
  const { data: dataSources = [], isLoading } = useDataSources();
  const { remove: removeDataSourceLocal } = useDataSourceMutations();

  // Get all data tables to count them per source
  const { data: allDataTables = [] } = useDataTables();

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Transform data sources for display
  const allDataSources = useMemo((): DataSourceWithTables[] => {
    return dataSources.map((source) => {
      const tableCount = allDataTables.filter(
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

  // Get icon for data source type
  const getTypeIcon = (type: string) => {
    switch (type) {
      case "notion":
        return <CloudIcon className="h-5 w-5" />;
      case "local":
        return <SpreadsheetIcon className="h-5 w-5" />;
      case "postgresql":
        return <DatabaseIcon className="h-5 w-5" />;
      default:
        return <DatabaseIcon className="h-5 w-5" />;
    }
  };

  // Get label for data source type
  const getTypeLabel = (type: string) => {
    switch (type) {
      case "notion":
        return "Notion";
      case "csv":
      case "local":
        return "Uploaded CSV";
      case "postgresql":
        return "PostgreSQL";
      default:
        return "Unknown";
    }
  };

  // Handle delete data source
  const handleDeleteDataSource = async (
    dataSourceId: UUID,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    await removeDataSourceLocal(dataSourceId);
  };

  // Render data source card
  const renderDataSourceCard = (item: DataSourceWithTables) => (
    <Card
      key={item.dataSource.id}
      className="group cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => router.push(`/data-sources/${item.dataSource.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="bg-muted flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
            {getTypeIcon(item.dataSource.type)}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="truncate font-medium">{item.dataSource.name}</h4>
              <Badge variant="secondary" className="text-xs">
                {getTypeLabel(item.dataSource.type)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              <TableIcon className="mr-1 inline h-3 w-3" />
              {item.tableCount} table{item.tableCount !== 1 ? "s" : ""}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Created{" "}
              {new Date(item.dataSource.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="text"
                icon={MoreIcon}
                iconOnly
                label="More options"
                size="sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => {}}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/data-sources/${item.dataSource.id}`);
                }}
              >
                <ExternalLinkIcon className="mr-2 h-4 w-4" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) =>
                  handleDeleteDataSource(
                    item.dataSource.id,
                    e as unknown as React.MouseEvent,
                  )
                }
              >
                <DeleteIcon className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );

  if (isLoading && dataSources.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading data sources…</p>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-screen flex-col">
      {/* Header */}
      <header className="bg-card/90 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Data Sources</h1>
              <p className="text-muted-foreground text-sm">
                {allDataSources.length} source
                {allDataSources.length !== 1 ? "s" : ""} connected
              </p>
            </div>
            <Button
              icon={PlusIcon}
              label="Add Source"
              onClick={() => setIsCreateModalOpen(true)}
            />
          </div>
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search data sources..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl px-6 py-6">
          {/* Data Sources List */}
          {filteredDataSources.length > 0 ? (
            <div className="grid gap-3">
              {filteredDataSources.map(renderDataSourceCard)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <DatabaseIcon className="text-muted-foreground h-8 w-8" />
              </div>
              {searchQuery ? (
                <>
                  <h3 className="mb-2 text-lg font-semibold">
                    No data sources found
                  </h3>
                  <p className="text-muted-foreground mb-4 text-sm">
                    No data sources match &quot;{searchQuery}&quot;
                  </p>
                  <Button
                    variant="outlined"
                    label="Clear search"
                    onClick={() => setSearchQuery("")}
                  />
                </>
              ) : (
                <>
                  <h3 className="mb-2 text-lg font-semibold">
                    No data sources yet
                  </h3>
                  <p className="text-muted-foreground mb-4 text-sm">
                    Connect your first data source to start analyzing
                  </p>
                  <Button
                    icon={PlusIcon}
                    label="Add Source"
                    onClick={() => setIsCreateModalOpen(true)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Create Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
