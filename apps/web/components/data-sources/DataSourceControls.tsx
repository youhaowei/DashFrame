"use client";

import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase } from "@dashframe/connector-notion";
import {
  useDataSourceMutations,
  useDataSources,
  useDataTableMutations,
  useDataTables,
} from "@dashframe/core";
import { InputField } from "@dashframe/ui";
import {
  ChevronDownIcon,
  DatabaseIcon,
  DeleteIcon,
  PlusIcon,
  RefreshIcon,
} from "@stdui/icons";
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Panel,
  Spinner,
  Surface,
} from "@stdui/react";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

// Ticks once a minute on the client so relative-time strings refresh
// without calling Date.now() during render.
const subscribeNow = (notify: () => void) => {
  const id = setInterval(notify, 60_000);
  return () => clearInterval(id);
};
const getNowSnapshot = () => Date.now();
const getNowServerSnapshot = () => 0;

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
      className={cn(
        !isFooter && "border-b border-neutral-border/40",
        className,
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-neutral-bg-muted/30">
        <h3 className="text-sm font-semibold text-neutral-fg">{title}</h3>
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 text-neutral-fg-subtle transition-transform duration-200",
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

type CachedDatabases = {
  databases: NotionDatabase[];
  timestamp: number;
};

const cacheKeyFor = (dataSourceId: string) =>
  `dashframe:notion-databases:${dataSourceId}`;

const readCache = (dataSourceId: string | null): CachedDatabases | null => {
  if (!dataSourceId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKeyFor(dataSourceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDatabases;
    return parsed;
  } catch (error) {
    console.error("Failed to load cached databases:", error);
    return null;
  }
};

// Subscribe to storage events so other tabs/components updating the cache
// flow back into render without a manual setState-in-effect.
const subscribeStorage = (callback: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};

export function DataSourceControls({ dataSourceId }: DataSourceControlsProps) {
  // Local override — set after a fresh fetch — wins over the cached read.
  const [override, setOverride] = useState<CachedDatabases | null>(null);
  const [overrideKey, setOverrideKey] = useState<string | null>(dataSourceId);
  // Reset override when data source changes during render.
  if (overrideKey !== dataSourceId) {
    setOverrideKey(dataSourceId);
    setOverride(null);
  }

  const cachedSnapshot = useSyncExternalStore(
    subscribeStorage,
    useCallback(() => {
      // Stable JSON snapshot keyed by dataSourceId so the store returns
      // referentially-equal values across renders when nothing changed.
      const cached = readCache(dataSourceId);
      return cached ? JSON.stringify(cached) : "";
    }, [dataSourceId]),
    () => "",
  );
  const cached: CachedDatabases | null = useMemo(
    () => (cachedSnapshot ? (JSON.parse(cachedSnapshot) as CachedDatabases) : null),
    [cachedSnapshot],
  );
  const effective = override ?? cached;
  const availableDatabases = useMemo<NotionDatabase[]>(
    () => effective?.databases ?? [],
    [effective],
  );
  const lastFetchTime: number | null = effective?.timestamp ?? null;
  const setAvailableDatabases = (databases: NotionDatabase[]) => {
    const next = { databases, timestamp: Date.now() };
    setOverride(next);
    if (dataSourceId && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(cacheKeyFor(dataSourceId), JSON.stringify(next));
      } catch (error) {
        console.error("Failed to persist cached databases:", error);
      }
    }
  };
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isDataTablesOpen, setIsDataTablesOpen] = useState(true);

  const now = useSyncExternalStore(
    subscribeNow,
    getNowSnapshot,
    getNowServerSnapshot,
  );

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
      // Updates state and persists to localStorage in one go.
      setAvailableDatabases(result);
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
          <p className="text-base font-medium text-neutral-fg">
            No data source selected
          </p>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
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
      <div className="border-b border-neutral-border/40 px-4 pt-4 pb-3">
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
            <p className="mt-1.5 text-xs text-neutral-fg-subtle">
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
          className="border-b border-neutral-border/40"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-neutral-bg-muted/30">
            <h3 className="text-sm font-semibold text-neutral-fg">
              Data Tables
            </h3>
            <div className="flex items-center gap-2">
              {lastFetchTime ? (
                <span className="text-[10px] text-neutral-fg-subtle">
                  synced{" "}
                  {(() => {
                    const diff = now - lastFetchTime;
                    const minutes = Math.floor(diff / 1000 / 60);
                    const hours = Math.floor(minutes / 60);
                    if (hours > 0) return `${hours}h ago`;
                    if (minutes > 0) return `${minutes}m ago`;
                    return "just now";
                  })()}
                </span>
              ) : (
                <span className="text-[10px] text-neutral-fg-subtle/70 italic">
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
                  "hover:bg-neutral-bg-emphasis hover:text-neutral-fg",
                  "focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none",
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
                  "h-4 w-4 text-neutral-fg-subtle transition-transform duration-200",
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
                  <p className="mb-2 text-xs font-medium text-neutral-fg-subtle">
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
                          <p className="mt-0.5 text-[10px] text-neutral-fg-subtle">
                            {formatRelativeTime(dt.lastFetchedAt)}
                          </p>
                        );
                      } else if (!dt.dataFrameId) {
                        statusText = (
                          <p className="mt-0.5 text-[10px] text-neutral-fg-subtle/70 italic">
                            No data cached
                          </p>
                        );
                      }

                      return (
                        <div
                          key={dt.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border p-2 transition-all",
                            "border-palette-primary/40 bg-palette-primary/5",
                            "hover:border-palette-primary/60 hover:bg-palette-primary/10",
                            "shadow-sm",
                          )}
                        >
                          <DatabaseIcon className="h-3.5 w-3.5 shrink-0 text-palette-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-neutral-fg">
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
                  <Spinner size="sm" className="text-neutral-fg-subtle" />
                </div>
              ) : (
                (() => {
                  // Extract nested ternaries into clear conditions
                  if (unconfiguredDatabases.length > 0) {
                    return (
                      <div>
                        <p className="mb-2 text-xs font-medium text-neutral-fg-subtle">
                          Available Notion databases (
                          {unconfiguredDatabases.length})
                        </p>
                        <div className="space-y-1.5">
                          {unconfiguredDatabases.map((db) => (
                            <div
                              key={db.id}
                              className="flex items-center gap-2 rounded-md border border-dashed border-neutral-border/50 bg-neutral-bg-muted/20 p-2"
                            >
                              <DatabaseIcon className="h-3 w-3 shrink-0 text-neutral-fg-subtle" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-neutral-fg">
                                  {db.title}
                                </p>
                              </div>
                              <Button
                                label="Add database"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleAddDatabase(db)}
                                className="h-6 px-2"
                                icon={PlusIcon}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (dataTables.length > 0) {
                    return (
                      <p className="py-2 text-center text-xs text-neutral-fg-subtle">
                        All Notion databases added
                      </p>
                    );
                  }
                  if (!lastFetchTime) {
                    return (
                      <p className="py-3 text-center text-xs text-neutral-fg-subtle">
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
        <div className="border-b border-neutral-border/40 px-4 py-3">
          <p className="text-xs font-medium text-neutral-fg-subtle">Files</p>
          <p className="mt-1 text-sm font-medium text-neutral-fg">
            {allTables?.length ?? 0}{" "}
            {(allTables?.length ?? 0) === 1 ? "file" : "files"}
          </p>
        </div>
      )}
    </Panel>
  );
}
