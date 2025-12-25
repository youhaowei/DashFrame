"use client";

import { useState, useEffect, useMemo } from "react";
import {
  DeleteIcon,
  DatabaseIcon,
  PlusIcon,
  RefreshIcon,
  LoaderIcon,
  ChevronDownIcon,
  Button,
  Surface,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Panel,
  InputField,
} from "@dashframe/ui";
import { toast } from "sonner";
import {
  useDataSources,
  useDataSourceMutations,
  useDataTables,
  useDataTableMutations,
} from "@dashframe/core";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase } from "@dashframe/connector-notion";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  isFooter?: boolean;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className,
  isFooter = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(!isFooter && "border-border/40 border-b", className)}
    >
      <CollapsibleTrigger className="hover:bg-muted/30 flex w-full items-center justify-between px-4 py-3 text-left transition-colors">
        <h3 className="text-foreground text-sm font-semibold">{title}</h3>
        <ChevronDownIcon
          className={cn(
            "text-muted-foreground h-4 w-4 transition-transform duration-200",
            // Footer collapses upward, so flip the logic
            isFooter ? !isOpen && "rotate-180" : isOpen && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface DataSourceControlsProps {
  dataSourceId: string | null;
}

export function DataSourceControls({ dataSourceId }: DataSourceControlsProps) {
  const [availableDatabases, setAvailableDatabases] = useState<
    NotionDatabase[]
  >([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [isDataTablesOpen, setIsDataTablesOpen] = useState(true);

  // Hydrate cached database list from localStorage
  useEffect(() => {
    if (!dataSourceId) return;

    try {
      const cacheKey = `dashframe:notion-databases:${dataSourceId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { databases, timestamp } = JSON.parse(cached);
        setAvailableDatabases(databases);
        setLastFetchTime(timestamp);
      }
    } catch (error) {
      console.error("Failed to load cached databases:", error);
    }
  }, [dataSourceId]);

  // Get data source from Dexie
  const { data: dataSources } = useDataSources();
  const { data: allTables } = useDataTables(dataSourceId ?? undefined);
  const dataSourceMutations = useDataSourceMutations();
  const tableMutations = useDataTableMutations();

  const dataSource = useMemo(
    () => dataSources?.find((s) => s.id === dataSourceId) ?? null,
    [dataSources, dataSourceId],
  );

  // tRPC mutation for fetching databases
  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();

  // Get configured DataTables
  const dataTables = useMemo(() => {
    if (!dataSource || dataSource.type !== "notion") return [];
    return allTables ?? [];
  }, [dataSource, allTables]);

  // Filter unconfigured databases
  const unconfiguredDatabases = useMemo(() => {
    if (!dataSource || dataSource.type !== "notion") return [];
    const configuredIds = new Set(dataTables.map((dt) => dt.table));
    return availableDatabases.filter((db) => !configuredIds.has(db.id));
  }, [dataSource, dataTables, availableDatabases]);

  // Fetch databases with permanent caching (only refreshes on manual click)
  const fetchDatabases = async (force = false) => {
    if (!dataSource || dataSource.type !== "notion" || !dataSource.apiKey)
      return;

    // Use cached data unless explicitly forced to refresh
    if (!force && lastFetchTime) {
      return; // Already have cached data, don't refetch
    }

    setIsLoadingDatabases(true);

    try {
      const result = await listDatabasesMutation.mutateAsync({
        apiKey: dataSource.apiKey,
      });
      const now = Date.now();
      setAvailableDatabases(result);
      setLastFetchTime(now);

      // Persist to localStorage
      try {
        const cacheKey = `dashframe:notion-databases:${dataSource.id}`;
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            databases: result,
            timestamp: now,
          }),
        );
      } catch (error) {
        console.error("Failed to cache databases:", error);
      }
    } catch (error) {
      console.error("Failed to fetch Notion databases:", error);
      toast.error("Failed to load databases from Notion");
    } finally {
      setIsLoadingDatabases(false);
    }
  };

  // Note: Database list is NOT auto-fetched on load.
  // Users must manually click the refresh button to sync from Notion.

  // Handler to add a database as DataTable
  const handleAddDatabase = async (database: NotionDatabase) => {
    if (!dataSource || dataSource.type !== "notion") return;

    try {
      await tableMutations.add(dataSource.id, database.title, database.id);
      toast.success(`Added "${database.title}"`);
    } catch (error) {
      console.error("Failed to add database:", error);
      toast.error("Failed to add database");
    }
  };

  if (!dataSource) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Surface elevation="inset" className="w-full p-8 text-center">
          <p className="text-foreground text-base font-medium">
            No data source selected
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Select a data source or create a new one to configure settings.
          </p>
        </Surface>
      </div>
    );
  }

  const handleDelete = async () => {
    if (
      confirm(
        `Are you sure you want to delete "${dataSource.name}"? This will remove all associated data.`,
      )
    ) {
      await dataSourceMutations.remove(dataSource.id);
      toast.success("Data source deleted");
    }
  };

  const handleNameChange = async (newName: string) => {
    await dataSourceMutations.update(dataSource.id, { name: newName });
  };

  const handleApiKeyChange = async (newApiKey: string) => {
    if (dataSource.type === "notion") {
      await dataSourceMutations.update(dataSource.id, { apiKey: newApiKey });
    }
  };

  const actionsFooter = (
    <CollapsibleSection title="Actions" defaultOpen={false} isFooter={true}>
      <div className="space-y-2">
        <Button
          label="Delete Data Source"
          color="danger"
          className="w-full"
          onClick={handleDelete}
          icon={DeleteIcon}
        />
      </div>
    </CollapsibleSection>
  );

  return (
    <Panel footer={actionsFooter}>
      {/* Name field at top */}
      <div className="border-border/40 border-b px-4 pb-3 pt-4">
        <InputField
          label="Name"
          value={dataSource.name}
          onChange={handleNameChange}
        />
      </div>

      {/* API Key for Notion */}
      {dataSource.type === "notion" && (
        <CollapsibleSection title="API Key" defaultOpen={false}>
          <div>
            <InputField
              type="password"
              value={dataSource.apiKey ?? ""}
              onChange={handleApiKeyChange}
              className="font-mono text-xs"
              placeholder="secret_..."
            />
            <p className="text-muted-foreground mt-1.5 text-xs">
              Your Notion integration token
            </p>
          </div>
        </CollapsibleSection>
      )}

      {/* Data Tables section for Notion */}
      {dataSource.type === "notion" && (
        <Collapsible
          open={isDataTablesOpen}
          onOpenChange={setIsDataTablesOpen}
          className="border-border/40 border-b"
        >
          <CollapsibleTrigger className="hover:bg-muted/30 flex w-full items-center justify-between px-4 py-3 text-left transition-colors">
            <h3 className="text-foreground text-sm font-semibold">
              Data Tables
            </h3>
            <div className="flex items-center gap-2">
              {lastFetchTime ? (
                <span className="text-muted-foreground text-[10px]">
                  synced{" "}
                  {(() => {
                    const diff = Date.now() - lastFetchTime;
                    const minutes = Math.floor(diff / 1000 / 60);
                    const hours = Math.floor(minutes / 60);
                    if (hours > 0) return `${hours}h ago`;
                    if (minutes > 0) return `${minutes}m ago`;
                    return "just now";
                  })()}
                </span>
              ) : (
                <span className="text-muted-foreground/70 text-[10px] italic">
                  not synced
                </span>
              )}
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isLoadingDatabases) {
                    fetchDatabases(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !isLoadingDatabases
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    fetchDatabases(true);
                  }
                }}
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                  isLoadingDatabases
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer",
                )}
                title="Refresh databases list from Notion"
                aria-label="Refresh databases list from Notion"
              >
                <RefreshIcon
                  className={cn(
                    "h-3 w-3",
                    isLoadingDatabases && "animate-spin",
                  )}
                />
              </div>
              <ChevronDownIcon
                className={cn(
                  "text-muted-foreground h-4 w-4 transition-transform duration-200",
                  isDataTablesOpen && "rotate-180",
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 px-4 pb-4">
              {/* Configured Data Tables */}
              {dataTables.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2 text-xs font-medium">
                    Added ({dataTables.length})
                  </p>
                  <div className="space-y-1.5">
                    {dataTables.map((dt) => {
                      // Format relative time
                      const formatRelativeTime = (timestamp: number) => {
                        const now = Date.now();
                        const diff = now - timestamp;
                        const minutes = Math.floor(diff / 1000 / 60);
                        const hours = Math.floor(minutes / 60);
                        const days = Math.floor(hours / 24);
                        if (days > 0) return `${days}d ago`;
                        if (hours > 0) return `${hours}h ago`;
                        if (minutes > 0) return `${minutes}m ago`;
                        return "just now";
                      };

                      // Determine status text
                      let statusText = null;
                      if (dt.lastFetchedAt) {
                        statusText = (
                          <p className="text-muted-foreground mt-0.5 text-[10px]">
                            {formatRelativeTime(dt.lastFetchedAt)}
                          </p>
                        );
                      } else if (!dt.dataFrameId) {
                        statusText = (
                          <p className="text-muted-foreground/70 mt-0.5 text-[10px] italic">
                            No data cached
                          </p>
                        );
                      }

                      return (
                        <div
                          key={dt.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border p-2 transition-all",
                            "border-primary/40 bg-primary/5",
                            "hover:border-primary/60 hover:bg-primary/10",
                            "shadow-sm",
                          )}
                        >
                          <DatabaseIcon className="text-primary h-3.5 w-3.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground truncate text-xs font-semibold">
                              {dt.name}
                            </p>
                            {statusText}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Available Notion Databases */}
              {isLoadingDatabases ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                </div>
              ) : (
                (() => {
                  // Extract nested ternaries into clear conditions
                  if (unconfiguredDatabases.length > 0) {
                    return (
                      <div>
                        <p className="text-muted-foreground mb-2 text-xs font-medium">
                          Available Notion databases (
                          {unconfiguredDatabases.length})
                        </p>
                        <div className="space-y-1.5">
                          {unconfiguredDatabases.map((db) => (
                            <div
                              key={db.id}
                              className="border-border/50 bg-muted/20 flex items-center gap-2 rounded-md border border-dashed p-2"
                            >
                              <Database className="text-muted-foreground h-3 w-3 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-foreground truncate text-xs font-medium">
                                  {db.title}
                                </p>
                              </div>
                              <Button
                                label="Add database"
                                size="sm"
                                variant="text"
                                onClick={() => handleAddDatabase(db)}
                                className="h-6 px-2"
                                icon={Plus}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (dataTables.length > 0) {
                    return (
                      <p className="text-muted-foreground py-2 text-center text-xs">
                        All Notion databases added
                      </p>
                    );
                  }
                  if (!lastFetchTime) {
                    return (
                      <p className="text-muted-foreground py-3 text-center text-xs">
                        Click the refresh button to load databases
                      </p>
                    );
                  }
                  return null;
                })()
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Files count for CSV */}
      {dataSource.type === "csv" && (
        <div className="border-border/40 border-b px-4 py-3">
          <p className="text-muted-foreground text-xs font-medium">Files</p>
          <p className="text-foreground mt-1 text-sm font-medium">
            {allTables?.length ?? 0}{" "}
            {(allTables?.length ?? 0) === 1 ? "file" : "files"}
          </p>
        </div>
      )}
    </Panel>
  );
}
