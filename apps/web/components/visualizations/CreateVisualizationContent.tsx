"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrameWithFields } from "@dashframe/csv";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase, NotionProperty } from "@dashframe/notion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@dashframe/convex";
import type { Id, Doc } from "@dashframe/convex/dataModel";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import {
  FileText,
  Database,
  Notion,
  Card,
  CardContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Button,
  Label,
  Alert,
  AlertDescription,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashframe/ui";
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";

interface CreateVisualizationContentProps {
  onComplete: () => void;
  onCancel?: () => void;
}

export function CreateVisualizationContent({
  onComplete,
  onCancel,
}: CreateVisualizationContentProps) {
  const router = useRouter();

  // Notion UI state
  const [notionApiKey, setNotionApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [notionDatabases, setNotionDatabases] = useState<NotionDatabase[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [databaseSchema, setDatabaseSchema] = useState<NotionProperty[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [insightMode, setInsightMode] = useState<"existing" | "new">("new");
  const [selectedInsightId, setSelectedInsightId] = useState<Id<"insights"> | null>(null);
  const [isFromExistingConnection, setIsFromExistingConnection] = useState(false);
  const [showNotionConfig, setShowNotionConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convex queries
  const dataSources = useQuery(api.dataSources.list) ?? [];
  const insights = useQuery(api.insights.list) ?? [];

  // Convex mutations
  const createDataSource = useMutation(api.dataSources.create);
  const createDataTable = useMutation(api.dataTables.create);
  const updateDataTable = useMutation(api.dataTables.update);
  const createInsight = useMutation(api.insights.create);

  // DataFrames store (stays client-side for large data)
  const createDataFrameFromCSV = useDataFramesStore((s) => s.createFromCSV);
  const createDataFrameFromInsight = useDataFramesStore((s) => s.createFromInsight);

  // tRPC for external Notion API calls
  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();
  const getDatabaseSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();

  // Find existing local and notion sources
  const localSource = useMemo(
    () => dataSources.find((s: Doc<"dataSources">) => s.type === "local"),
    [dataSources]
  );
  const notionSource = useMemo(
    () => dataSources.find((s: Doc<"dataSources">) => s.type === "notion"),
    [dataSources]
  );

  // Load persisted Notion API key
  useEffect(() => {
    if (notionSource?.apiKey) {
      setNotionApiKey(notionSource.apiKey);
    }
  }, [notionSource?.apiKey]);

  // Handle CSV upload
  const handleCSVUpload = useCallback(
    async (file: File) => {
      setError(null);

      Papa.parse(file, {
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: async (result: ParseResult<string>) => {
          if (result.errors.length) {
            setError(
              result.errors
                .map((err: ParseError) => err.message)
                .join("\n")
            );
            return;
          }

          try {
            // Ensure local source exists
            let sourceId = localSource?._id;
            if (!sourceId) {
              sourceId = await createDataSource({
                type: "local",
                name: "Local Storage",
              });
            }

            const tableName = file.name.replace(/\.csv$/i, "");
            const { dataFrame, fields, sourceSchema } = csvToDataFrameWithFields(
              result.data,
              crypto.randomUUID()
            );

            if (!fields.length) {
              setError("CSV did not contain any columns.");
              return;
            }

            // Create DataFrame in client-side store
            const dataFrameId = createDataFrameFromCSV(
              sourceId as string,
              `${tableName} Data`,
              dataFrame
            );

            // Create data table in Convex
            // Note: CSV's SourceSchema uses 'columns', Convex expects 'fields'
            const tableId = await createDataTable({
              dataSourceId: sourceId,
              name: tableName,
              table: file.name,
              sourceSchema: {
                fields: sourceSchema.columns.map((col: { name: string; type: string }) => ({
                  name: col.name,
                  type: col.type,
                })),
              },
              dataFrameId,
            });

            // Create insight in Convex (with no selected fields - draft)
            const insightId = await createInsight({
              name: tableName,
              baseTableId: tableId,
              selectedFieldIds: [], // Draft - no fields selected yet
            });

            router.push(`/insights/${insightId}`);
            onComplete();
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Failed to process CSV"
            );
          }
        },
      });
    },
    [
      localSource,
      createDataSource,
      createDataTable,
      createInsight,
      createDataFrameFromCSV,
      router,
      onComplete,
    ]
  );

  // Fetch Notion databases
  const fetchNotionDatabases = useCallback(async () => {
    if (!notionSource?.apiKey) return;

    setIsLoadingDatabases(true);
    try {
      const databases = await listDatabasesMutation.mutateAsync({
        apiKey: notionSource.apiKey,
      });
      setNotionDatabases(databases);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load Notion databases"
      );
    } finally {
      setIsLoadingDatabases(false);
    }
  }, [notionSource?.apiKey, listDatabasesMutation]);

  // Handle existing Notion connection selection
  const handleSelectExistingNotion = useCallback(async () => {
    setIsFromExistingConnection(true);
    setInsightMode("existing");
    setShowNotionConfig(true);
    await fetchNotionDatabases();
  }, [fetchNotionDatabases]);

  // Handle new Notion connection
  const handleConnectNotion = useCallback(async () => {
    if (!notionApiKey.trim()) {
      setError("Please enter a Notion API key");
      return;
    }

    setError(null);
    setIsLoadingDatabases(true);

    try {
      const databases = await listDatabasesMutation.mutateAsync({
        apiKey: notionApiKey,
      });
      setNotionDatabases(databases);

      // Create or update Notion source in Convex
      if (!notionSource) {
        await createDataSource({
          type: "notion",
          name: "Notion",
          apiKey: notionApiKey,
        });
      }

      if (databases.length === 0) {
        setError("No databases found. Make sure your integration has access.");
      } else {
        setIsFromExistingConnection(false);
        setInsightMode("new");
        setShowNotionConfig(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to Notion"
      );
      setNotionDatabases([]);
    } finally {
      setIsLoadingDatabases(false);
    }
  }, [notionApiKey, listDatabasesMutation, notionSource, createDataSource]);

  // Handle database selection
  const handleSelectDatabase = useCallback(
    async (databaseId: string) => {
      const apiKey = notionSource?.apiKey || notionApiKey;
      if (!apiKey) return;

      setSelectedDatabaseId(databaseId);
      setError(null);
      setIsLoadingSchema(true);

      try {
        const schema = await getDatabaseSchemaMutation.mutateAsync({
          apiKey,
          databaseId,
        });
        setDatabaseSchema(schema);
        setSelectedPropertyIds(schema.map((prop) => prop.id));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch database schema"
        );
        setDatabaseSchema([]);
        setSelectedPropertyIds([]);
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [notionSource?.apiKey, notionApiKey, getDatabaseSchemaMutation]
  );

  // Handle property toggle
  const handleToggleProperty = useCallback((propertyId: string) => {
    setSelectedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId]
    );
  }, []);

  // Handle creating Notion visualization
  const handleCreateNotionVisualization = useCallback(async () => {
    if (!selectedDatabaseId || selectedPropertyIds.length === 0) return;

    setError(null);

    try {
      const apiKey = notionSource?.apiKey || notionApiKey;
      if (!apiKey || !notionSource) {
        setError("Notion connection not found");
        return;
      }

      let insightId: Id<"insights">;

      if (insightMode === "existing" && selectedInsightId) {
        insightId = selectedInsightId;
      } else {
        // Find database name
        const selectedDb = notionDatabases.find((db) => db.id === selectedDatabaseId);
        const tableName = selectedDb?.title || "Notion Table";

        // Create data table
        const tableId = await createDataTable({
          dataSourceId: notionSource._id,
          name: tableName,
          table: selectedDatabaseId,
          sourceSchema: {
            fields: databaseSchema
              .filter((prop) => selectedPropertyIds.includes(prop.id))
              .map((prop) => ({
                name: prop.name,
                type: prop.type,
                notionType: prop.type,
              })),
          },
        });

        // Create insight
        insightId = await createInsight({
          name: `${tableName} Insight`,
          baseTableId: tableId,
          selectedFieldIds: [],
        });
      }

      // Fetch data from Notion
      const dataFrame = await queryDatabaseMutation.mutateAsync({
        apiKey,
        databaseId: selectedDatabaseId,
        selectedPropertyIds,
      });

      if (!dataFrame.columns || !dataFrame.columns.length) {
        setError("No data found in the selected database");
        return;
      }

      // Create DataFrame in client-side store
      const dataFrameId = createDataFrameFromInsight(
        insightId as string,
        "Notion Data",
        dataFrame
      );

      // Update the insight's dataFrameId would require an update mutation
      // For now, the DataFrame is stored client-side and linked by convention

      router.push(`/insights/${insightId}`);
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create visualization"
      );
    }
  }, [
    selectedDatabaseId,
    selectedPropertyIds,
    insightMode,
    selectedInsightId,
    notionSource,
    notionApiKey,
    notionDatabases,
    databaseSchema,
    createDataTable,
    createInsight,
    queryDatabaseMutation,
    createDataFrameFromInsight,
    router,
    onComplete,
  ]);

  // Navigate to existing insight
  const handleNavigateToInsight = useCallback(
    (insightId: Id<"insights">) => {
      router.push(`/insights/${insightId}`);
      onComplete();
    },
    [router, onComplete]
  );

  // Notion config panel
  const notionConfigPanel = showNotionConfig ? (
    <Card className="space-y-4">
      <div className="flex items-center justify-between px-4 pt-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Configure Notion insight
          </p>
          <p className="text-sm text-foreground">Choose database and properties</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNotionConfig(false)}
        >
          Close
        </Button>
      </div>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="modal-database">Select Database</Label>
            <Select
              value={selectedDatabaseId || ""}
              onValueChange={handleSelectDatabase}
            >
              <SelectTrigger id="modal-database">
                <SelectValue placeholder="Choose a database..." />
              </SelectTrigger>
              <SelectContent>
                {notionDatabases.map((db) => (
                  <SelectItem key={db.id} value={db.id}>
                    {db.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoadingSchema && (
            <p className="text-muted-foreground text-sm">
              Loading properties...
            </p>
          )}
          {databaseSchema.length > 0 && !isLoadingSchema && (
            <div className="space-y-2">
              <Label>Select Properties</Label>
              <div className="border-border max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
                {databaseSchema.map((prop) => (
                  <label
                    key={prop.id}
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                  >
                    <Checkbox
                      checked={selectedPropertyIds.includes(prop.id)}
                      onCheckedChange={() => handleToggleProperty(prop.id)}
                    />
                    <span className="flex-1">{prop.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {prop.type}
                    </span>
                  </label>
                ))}
              </div>
              <Button
                onClick={handleCreateNotionVisualization}
                disabled={selectedPropertyIds.length === 0}
                className="w-full"
              >
                Create Table Visualization
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  ) : null;

  // Existing insights section
  const existingInsightsSection = insights.length > 0 ? (
    <section className="space-y-3">
      <h4 className="text-muted-foreground text-sm font-medium">
        Existing Insights
      </h4>
      <div className="grid gap-3">
        {insights.map((insight: Doc<"insights">) => (
          <Card
            key={insight._id}
            className="hover:border-primary cursor-pointer transition"
            onClick={() => handleNavigateToInsight(insight._id)}
          >
            <CardContent className="flex items-center gap-3 p-3">
              <Database className="text-muted-foreground h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{insight.name}</div>
                <div className="text-muted-foreground text-xs">
                  {insight.selectedFieldIds.length} fields selected
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  ) : null;

  // Existing data sources section
  const existingSourcesSection = dataSources.length > 0 ? (
    <section className="space-y-3">
      <h4 className="text-muted-foreground text-sm font-medium">
        Existing Connections
      </h4>
      <div className="grid gap-3">
        {dataSources.map((source: Doc<"dataSources">) => {
          if (source.type === "notion") {
            return (
              <Card
                key={source._id}
                className="hover:border-primary cursor-pointer transition"
                onClick={handleSelectExistingNotion}
              >
                <CardContent className="flex items-center gap-3 p-3">
                  <Notion className="h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{source.name}</div>
                    <div className="text-muted-foreground text-xs">
                      Notion Database
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          }

          if (source.type === "local") {
            return (
              <Card
                key={source._id}
                className="hover:border-primary cursor-pointer transition"
              >
                <CardContent className="flex items-center gap-3 p-3">
                  <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{source.name}</div>
                    <div className="text-muted-foreground text-xs">
                      Local CSV Files
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          }

          return null;
        })}
      </div>
    </section>
  ) : null;

  // Add new source section
  const addNewSourceSection = (
    <section className="space-y-3">
      <h4 className="text-muted-foreground text-sm font-medium">
        Add New Source
      </h4>
      <AddConnectionPanel
        onCsvSelect={handleCSVUpload}
        csvDescription="Upload a CSV file with headers in the first row."
        csvHelperText="Supports .csv files up to 5MB"
        notion={{
          apiKey: notionApiKey,
          showApiKey,
          onApiKeyChange: setNotionApiKey,
          onToggleShowApiKey: () => setShowApiKey((prev) => !prev),
          onConnectNotion: handleConnectNotion,
          connectButtonLabel: isLoadingDatabases ? "Connecting..." : "Connect",
          connectDisabled: !notionApiKey || isLoadingDatabases,
        }}
      />
    </section>
  );

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="space-y-6 overflow-y-auto pr-2">
        {existingInsightsSection}
        {existingSourcesSection}
        {addNewSourceSection}
        {notionConfigPanel}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
