"use client";

import { useState, useCallback, useEffect } from "react";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrame } from "@dash-frame/csv";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase, NotionProperty } from "@dash-frame/notion";
import {
  useDataSourcesStore,
  useDataFramesStore,
  useVisualizationsStore,
} from "@/lib/stores";
import { buildVegaLiteSpec } from "@/lib/spec";
import type { TopLevelSpec } from "vega-lite";
import type { DataFrame } from "@dash-frame/dataframe";
import type {
  VisualizationType,
  VisualizationEncoding,
} from "@/lib/stores/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Helper function to extract visualization type and encoding from a Vega-Lite spec
function extractVisualizationMetadata(
  spec: TopLevelSpec,
): {
  visualizationType: VisualizationType;
  encoding?: VisualizationEncoding;
} {
  // Extract mark type
  const mark =
    "mark" in spec && typeof spec.mark === "string" ? spec.mark : "bar";
  const visualizationType = mark === "line" ? "line" : "bar";

  // Extract encoding if it exists
  const encoding =
    "encoding" in spec &&
      spec.encoding &&
      typeof spec.encoding === "object" &&
      "x" in spec.encoding &&
      "y" in spec.encoding
      ? {
        x:
          spec.encoding.x &&
            typeof spec.encoding.x === "object" &&
            "field" in spec.encoding.x &&
            typeof spec.encoding.x.field === "string"
            ? spec.encoding.x.field
            : undefined,
        y:
          spec.encoding.y &&
            typeof spec.encoding.y === "object" &&
            "field" in spec.encoding.y &&
            typeof spec.encoding.y.field === "string"
            ? spec.encoding.y.field
            : undefined,
      }
      : undefined;

  return { visualizationType, encoding };
}

export function DataSourcesPanel() {
  // Store actions
  const addCSV = useDataSourcesStore((s) => s.addCSV);
  const setNotion = useDataSourcesStore((s) => s.setNotion);
  const getNotion = useDataSourcesStore((s) => s.getNotion);
  const persistedNotionConnection = useDataSourcesStore((s) => s.getNotion());
  const addInsight = useDataSourcesStore((s) => s.addInsight);
  const createDataFrameFromCSV = useDataFramesStore((s) => s.createFromCSV);
  const createDataFrameFromInsight = useDataFramesStore(
    (s) => s.createFromInsight,
  );
  const createVisualization = useVisualizationsStore((s) => s.create);

  // UI state
  const [activeTab, setActiveTab] = useState<"csv" | "notion">("csv");
  const [error, setError] = useState<string | null>(null);

  // Notion state
  const [notionApiKey, setNotionApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [notionDatabases, setNotionDatabases] = useState<NotionDatabase[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(
    null,
  );
  const [databaseSchema, setDatabaseSchema] = useState<NotionProperty[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Hydrate persisted Notion API key into the input so refreshes preserve it
  useEffect(() => {
    setNotionApiKey(persistedNotionConnection?.apiKey ?? "");
  }, [persistedNotionConnection?.apiKey]);

  // tRPC mutations
  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();
  const getDatabaseSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();

  // Process CSV data and create visualization
  const processCSVData = useCallback(
    (
      dataFrame: ReturnType<typeof csvToDataFrame>,
      fileName: string,
      fileSize: number,
    ) => {
      // Generate UUID for data source
      const dataSourceId = crypto.randomUUID();

      // Create DataFrame first (with dataSourceId reference)
      const dataFrameId = createDataFrameFromCSV(
        dataSourceId,
        `${fileName} Data`,
        dataFrame,
      );

      // Create CSV data source (with dataFrameId reference)
      addCSV(
        fileName.replace(/\.csv$/i, ""),
        fileName,
        fileSize,
        dataFrameId,
      );

      // Create default Vega-Lite spec
      const defaultSpec = buildVegaLiteSpec(dataFrame, {
        x: dataFrame.columns[0]?.name ?? null,
        y:
          dataFrame.columns.find((col) => col.type === "number")?.name ??
          dataFrame.columns[1]?.name ??
          null,
      });

      if (defaultSpec) {
        const { visualizationType, encoding } =
          extractVisualizationMetadata(defaultSpec);
        const { data, ...specWithoutData } = defaultSpec;

        createVisualization(
          {
            dataFrameId,
          },
          `${fileName} Chart`,
          specWithoutData,
          visualizationType,
          encoding,
        );
      }
    },
    [addCSV, createDataFrameFromCSV, createVisualization],
  );

  // CSV Upload Handler
  const handleFileUpload = useCallback(
    (file: File) => {
      setError(null);

      Papa.parse(file, {
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (result: ParseResult<string>) => {
          if (result.errors.length) {
            setError(
              result.errors.map((err: ParseError) => err.message).join("\n"),
            );
            return;
          }

          const dataFrame = csvToDataFrame(result.data);

          if (!dataFrame.columns.length) {
            setError("CSV did not contain any columns.");
            return;
          }

          processCSVData(dataFrame, file.name, file.size);
        },
      });
    },
    [processCSVData],
  );

  // Notion Connection Handler
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

      // Create or update Notion data source
      setNotion("Notion", notionApiKey);

      if (databases.length === 0) {
        setError("No databases found. Make sure your integration has access.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to Notion",
      );
      setNotionDatabases([]);
    } finally {
      setIsLoadingDatabases(false);
    }
  }, [notionApiKey, listDatabasesMutation, setNotion]);

  // Database Selection Handler
  const handleSelectDatabase = useCallback(
    async (databaseId: string) => {
      if (!notionApiKey) return;

      setSelectedDatabaseId(databaseId);
      setError(null);
      setIsLoadingSchema(true);

      try {
        const schema = await getDatabaseSchemaMutation.mutateAsync({
          apiKey: notionApiKey,
          databaseId,
        });
        setDatabaseSchema(schema);
        // Select all properties by default
        setSelectedPropertyIds(schema.map((prop) => prop.id));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch database schema",
        );
        setDatabaseSchema([]);
        setSelectedPropertyIds([]);
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [notionApiKey, getDatabaseSchemaMutation],
  );

  // Property Toggle Handler
  const handleToggleProperty = useCallback((propertyId: string) => {
    setSelectedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    );
  }, []);

  // Process Notion data and create visualization
  const processNotionData = useCallback(
    (
      dataFrame: DataFrame,
      notionSourceId: string,
      insightId: string,
    ) => {
      // Create DataFrame from insight
      const dataFrameId = createDataFrameFromInsight(
        notionSourceId,
        insightId,
        "Notion Data",
        dataFrame,
      );

      // Create default Vega-Lite spec
      const defaultSpec = buildVegaLiteSpec(dataFrame, {
        x: dataFrame.columns[0]?.name ?? null,
        y:
          dataFrame.columns.find((col) => col.type === "number")?.name ??
          dataFrame.columns[1]?.name ??
          null,
      });

      if (defaultSpec) {
        const { visualizationType, encoding } =
          extractVisualizationMetadata(defaultSpec);
        const { data, ...specWithoutData } = defaultSpec;

        createVisualization(
          {
            dataFrameId,
            dataSourceId: notionSourceId,
            insightId,
          },
          "Notion Chart",
          specWithoutData,
          visualizationType,
          encoding,
        );
      }
    },
    [createDataFrameFromInsight, createVisualization],
  );

  // Import from Notion Handler
  const handleImportNotion = useCallback(async () => {
    if (
      !notionApiKey ||
      !selectedDatabaseId ||
      selectedPropertyIds.length === 0
    ) {
      setError("Please select a database and at least one property");
      return;
    }

    const notionSource = getNotion();
    if (!notionSource) {
      setError("Notion connection not found");
      return;
    }

    setError(null);
    setIsImporting(true);

    try {
      // Create insight
      const insightId = addInsight(
        notionSource.id,
        `${selectedDatabaseId} Insight`,
        selectedDatabaseId,
        selectedPropertyIds,
      );

      // Fetch data
      const dataFrame = await queryDatabaseMutation.mutateAsync({
        apiKey: notionApiKey,
        databaseId: selectedDatabaseId,
        selectedPropertyIds,
      });

      if (!dataFrame.columns.length) {
        setError("No data found in the selected database");
        return;
      }

      processNotionData(dataFrame, notionSource.id, insightId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import from Notion",
      );
    } finally {
      setIsImporting(false);
    }
  }, [
    notionApiKey,
    selectedDatabaseId,
    selectedPropertyIds,
    getNotion,
    addInsight,
    queryDatabaseMutation,
    processNotionData,
  ]);

  return (
    <Card className="space-y-4 shadow-lg">
      <CardContent className="pt-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "csv" | "notion")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="csv">CSV File</TabsTrigger>
            <TabsTrigger value="notion">Notion DB</TabsTrigger>
          </TabsList>

          {/* CSV Upload Section */}
          <TabsContent value="csv" className="space-y-4">
            <CardHeader className="p-0">
              <CardTitle className="text-lg">Upload CSV</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose a CSV file with headers in the first row. The preview
                automatically infers column types.
              </p>
            </CardHeader>

            <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-input bg-muted/50 p-6 text-center text-sm font-medium transition hover:border-primary hover:bg-muted">
              <span className="text-foreground">Select CSV</span>
              <span className="mt-2 text-xs font-normal text-muted-foreground">
                Supports .csv files up to 5MB
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
            </label>
          </TabsContent>

          {/* Notion Connection Section */}
          <TabsContent value="notion" className="space-y-4">
            <CardHeader className="p-0">
              <CardTitle className="text-lg">Connect to Notion</CardTitle>
            </CardHeader>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="notion-api-key">
                  API Key
                  <span className="ml-1 text-xs text-yellow-500">
                    (stored in browser)
                  </span>
                </Label>
                <div className="relative">
                  <Input
                    id="notion-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={notionApiKey}
                    onChange={(e) => setNotionApiKey(e.target.value)}
                    placeholder="secret_..."
                    className="pr-20"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-1 top-1/2 h-7 -translate-y-1/2 text-xs"
                  >
                    {showApiKey ? "Hide" : "Show"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Create an integration at{" "}
                  <a
                    href="https://www.notion.so/my-integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    notion.so/my-integrations
                  </a>
                </p>
              </div>

              <Button
                onClick={handleConnectNotion}
                disabled={!notionApiKey || isLoadingDatabases}
                className="w-full"
              >
                {isLoadingDatabases ? "Connecting..." : "Connect"}
              </Button>

              {/* Database Picker */}
              {notionDatabases.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="notion-database">Select Database</Label>
                  <Select
                    value={selectedDatabaseId || ""}
                    onValueChange={handleSelectDatabase}
                  >
                    <SelectTrigger id="notion-database">
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
              )}

              {/* Property Selection */}
              {isLoadingSchema && (
                <p className="text-sm text-muted-foreground">Loading properties...</p>
              )}
              {databaseSchema.length > 0 && !isLoadingSchema && (
                <div className="space-y-2">
                  <Label>Select Properties</Label>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                    {databaseSchema.map((prop) => (
                      <label
                        key={prop.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={selectedPropertyIds.includes(prop.id)}
                          onCheckedChange={() => handleToggleProperty(prop.id)}
                        />
                        <span className="flex-1 text-foreground">{prop.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {prop.type}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Import Button */}
              {selectedDatabaseId && selectedPropertyIds.length > 0 && (
                <Button
                  onClick={handleImportNotion}
                  disabled={isImporting}
                  variant="default"
                  className="w-full"
                >
                  {isImporting ? "Importing..." : "Import Data"}
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>
              <pre className="overflow-auto text-xs">{error}</pre>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
