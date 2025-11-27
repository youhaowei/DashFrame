"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { DataSource } from "@/lib/stores/types";
import type { UUID } from "@dashframe/dataframe";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import {
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  Database,
  TableIcon,
  Plus,
  Trash2,
  MoreHorizontal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashframe/ui";
import { LuSearch, LuExternalLink, LuCloud, LuFileSpreadsheet } from "react-icons/lu";
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

  // Local stores
  const { data: dataSources, isLoading } = useStoreQuery(
    useDataSourcesStore,
    (state) => state.getAll(),
  );
  const removeDataSourceLocal = useDataSourcesStore((state) => state.remove);

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Transform data sources for display
  const allDataSources = useMemo((): DataSourceWithTables[] => {
    return dataSources.map((source) => ({
      dataSource: source,
      tableCount: source.dataTables.size,
    }));
  }, [dataSources]);

  // Filter data sources by search query
  const filteredDataSources = useMemo(() => {
    if (!searchQuery.trim()) return allDataSources;
    const query = searchQuery.toLowerCase();
    return allDataSources.filter(
      (item) =>
        item.dataSource.name.toLowerCase().includes(query) ||
        item.dataSource.type.toLowerCase().includes(query)
    );
  }, [allDataSources, searchQuery]);

  // Get icon for data source type
  const getTypeIcon = (type: string) => {
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
  };

  // Get label for data source type
  const getTypeLabel = (type: string) => {
    switch (type) {
      case "notion":
        return "Notion";
      case "local":
        return "Uploaded CSV";
      case "postgresql":
        return "PostgreSQL";
      default:
        return "Unknown";
    }
  };

  // Handle delete data source (LOCAL ONLY)
  const handleDeleteDataSource = (
    dataSourceId: UUID,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    e.preventDefault();
    removeDataSourceLocal(dataSourceId);
  };

  // Render data source card
  const renderDataSourceCard = (item: DataSourceWithTables) => (
    <Card
      key={item.dataSource.id}
      className="group hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => router.push(`/data-sources/${item.dataSource.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
            {getTypeIcon(item.dataSource.type)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h4 className="font-medium truncate">{item.dataSource.name}</h4>
              <Badge variant="secondary" className="text-xs">
                {getTypeLabel(item.dataSource.type)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              <TableIcon className="h-3 w-3 inline mr-1" />
              {item.tableCount} table{item.tableCount !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
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
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/data-sources/${item.dataSource.id}`);
                }}
              >
                <LuExternalLink className="h-4 w-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) =>
                  handleDeleteDataSource(
                    item.dataSource.id,
                    e as unknown as React.MouseEvent
                  )
                }
              >
                <Trash2 className="h-4 w-4 mr-2" />
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
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Data Sources</h1>
              <p className="text-sm text-muted-foreground">
                {allDataSources.length} source{allDataSources.length !== 1 ? "s" : ""}{" "}
                connected
              </p>
            </div>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Source
            </Button>
          </div>
          <div className="relative">
            <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
        <div className="container mx-auto px-6 py-6 max-w-4xl">
          {/* Data Sources List */}
          {filteredDataSources.length > 0 ? (
            <div className="grid gap-3">
              {filteredDataSources.map(renderDataSourceCard)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Database className="h-8 w-8 text-muted-foreground" />
              </div>
              {searchQuery ? (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    No data sources found
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    No data sources match "{searchQuery}"
                  </p>
                  <Button variant="outline" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    No data sources yet
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Connect your first data source to start analyzing
                  </p>
                  <Button onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Source
                  </Button>
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
