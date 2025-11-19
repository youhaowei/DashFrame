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
import { isCSVDataSource, isNotionDataSource } from "@/lib/stores/types";
import type { TopLevelSpec } from "vega-lite";
import { FiFileText, FiDatabase } from "react-icons/fi";
import { SiNotion } from "react-icons/si";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";

interface CreateVisualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "source" | "insight";
type SourceType = "csv-upload" | "csv-existing" | "notion";

export function CreateVisualizationModal({
  isOpen,
  onClose,
}: CreateVisualizationModalProps) {
  // Current step
  const [currentStep, setCurrentStep] = useState<Step>("source");

  // Step 1: Source selection
  const [sourceType, setSourceType] = useState<SourceType | null>(null);

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
  const [insightMode, setInsightMode] = useState<"existing" | "new">("new");
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(
    null,
  );
  const [isFromExistingConnection, setIsFromExistingConnection] =
    useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Store actions
  const addCSV = useDataSourcesStore((s) => s.addCSV);
  const setNotion = useDataSourcesStore((s) => s.setNotion);
  const getNotion = useDataSourcesStore((s) => s.getNotion);
  const getAll = useDataSourcesStore((s) => s.getAll);
  const persistedNotionConnection = useDataSourcesStore((s) => s.getNotion());
  const addInsight = useDataSourcesStore((s) => s.addInsight);
  const createDataFrameFromCSV = useDataFramesStore((s) => s.createFromCSV);
  const createDataFrameFromInsight = useDataFramesStore(
    (s) => s.createFromInsight,
  );
  const createVisualization = useVisualizationsStore((s) => s.create);

  // Fetch all existing data sources
  const existingDataSources = getAll();

  // tRPC mutations
  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();
  const getDatabaseSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();

  // Hydrate Notion API key
  useEffect(() => {
    setNotionApiKey(persistedNotionConnection?.apiKey ?? "");
  }, [persistedNotionConnection?.apiKey]);

  // Reset modal state when closed
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep("source");
      setSourceType(null);
      setSelectedDatabaseId(null);
      setDatabaseSchema([]);
      setSelectedPropertyIds([]);
      setInsightMode("new");
      setSelectedInsightId(null);
      setIsFromExistingConnection(false);
      setError(null);
    }
  }, [isOpen]);

  // Handle existing CSV source selection
  const handleSelectExistingCSV = useCallback(
    (dataSourceId: string, dataFrameId: string, name: string) => {
      const emptySpec: Omit<TopLevelSpec, "data"> = {
        $schema: "https://vega.github.io/schema/vega-lite/v6.json",
      };

      createVisualization(
        { dataFrameId },
        `${name} - table`,
        emptySpec,
        "table",
      );

      onClose();
    },
    [createVisualization, onClose],
  );

  // Handle existing Notion source selection
  const handleSelectExistingNotion = useCallback(async () => {
    setSourceType("notion");
    setIsFromExistingConnection(true);
    setInsightMode("existing");
    setCurrentStep("insight");

    // Fetch databases for existing connection (needed for "Create New" tab)
    const notionConnection = getNotion();
    if (notionConnection) {
      setIsLoadingDatabases(true);
      try {
        const databases = await listDatabasesMutation.mutateAsync({
          apiKey: notionConnection.apiKey,
        });
        setNotionDatabases(databases);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load Notion databases",
        );
      } finally {
        setIsLoadingDatabases(false);
      }
    }
  }, [getNotion, listDatabasesMutation]);

  // CSV Upload Handler
  const handleCSVUpload = useCallback((file: File) => {
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

        // Create CSV visualization immediately
        const dataSourceId = crypto.randomUUID();

        const dataFrameId = createDataFrameFromCSV(
          dataSourceId,
          `${file.name} Data`,
          dataFrame,
        );

        addCSV(
          file.name.replace(/\.csv$/i, ""),
          file.name,
          file.size,
          dataFrameId,
        );

        // Create a minimal Vega-Lite spec (will be built dynamically by VisualizationDisplay)
        const emptySpec: Omit<TopLevelSpec, "data"> = {
          $schema: "https://vega.github.io/schema/vega-lite/v6.json",
        };

        createVisualization(
          { dataFrameId },
          `${file.name} - table`,
          emptySpec,
          "table",
        );

        onClose();
      },
    });
  }, [createDataFrameFromCSV, addCSV, createVisualization, onClose]);

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
      } else {
        // Move to insight step (new connection)
        setIsFromExistingConnection(false);
        setInsightMode("new");
        setCurrentStep("insight");
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

  // Handle selecting an existing insight
  const handleSelectExistingInsight = useCallback(
    async (insightId: string, databaseId: string, propertyIds: string[]) => {
      setSelectedInsightId(insightId);
      setSelectedDatabaseId(databaseId);
      setSelectedPropertyIds(propertyIds);

      // Fetch schema for this database to show property names
      if (notionApiKey) {
        setIsLoadingSchema(true);
        try {
          const schema = await getDatabaseSchemaMutation.mutateAsync({
            apiKey: notionApiKey,
            databaseId,
          });
          setDatabaseSchema(schema);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to fetch database schema",
          );
        } finally {
          setIsLoadingSchema(false);
        }
      }
    },
    [notionApiKey, getDatabaseSchemaMutation],
  );

  // Create Notion visualization
  const handleCreateNotionVisualization = useCallback(async () => {
    if (!selectedDatabaseId || selectedPropertyIds.length === 0) {
      return;
    }

    setError(null);

    try {
      const notionSource = getNotion();
      if (!notionSource) {
        setError("Notion connection not found");
        return;
      }

      // Determine insight ID (use existing or create new)
      let insightId: string;
      if (insightMode === "existing" && selectedInsightId) {
        // Reuse existing insight
        insightId = selectedInsightId;
      } else {
        // Create new insight
        insightId = addInsight(
          notionSource.id,
          `${selectedDatabaseId} Insight`,
          selectedDatabaseId,
          selectedPropertyIds,
        );
      }

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

      // Create DataFrame from insight
      const dataFrameId = createDataFrameFromInsight(
        notionSource.id,
        insightId,
        "Notion Data",
        dataFrame,
      );

      // Create a minimal Vega-Lite spec (will be built dynamically by VisualizationDisplay)
      const emptySpec: Omit<TopLevelSpec, "data"> = {
        $schema: "https://vega.github.io/schema/vega-lite/v6.json",
      };

      createVisualization(
        {
          dataFrameId,
          dataSourceId: notionSource.id,
          insightId,
        },
        `Notion - table`,
        emptySpec,
        "table",
      );

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create visualization",
      );
    }
  }, [
    selectedDatabaseId,
    selectedPropertyIds,
    insightMode,
    selectedInsightId,
    getNotion,
    addInsight,
    queryDatabaseMutation,
    notionApiKey,
    createDataFrameFromInsight,
    createVisualization,
    onClose,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Visualization</DialogTitle>
        </DialogHeader>

        {/* Step Content */}
        <div className="min-h-[400px]">
          {/* Step 1: Source Selection */}
          {currentStep === "source" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Choose Data Source</h3>

              {/* Existing Sources */}
              {existingDataSources.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    Existing Sources
                  </h4>
                  <div className="space-y-2">
                    {existingDataSources.map((source) => {
                      if (isCSVDataSource(source)) {
                        return (
                          <Card
                            key={source.id}
                            className="cursor-pointer transition hover:border-primary"
                            onClick={() =>
                              handleSelectExistingCSV(
                                source.id,
                                source.dataFrameId,
                                source.name,
                              )
                            }
                          >
                            <CardContent className="flex items-center gap-3 p-3">
                              <FiFileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">{source.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {source.fileName}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      } else if (isNotionDataSource(source)) {
                        return (
                          <Card
                            key={source.id}
                            className="cursor-pointer transition hover:border-primary"
                            onClick={handleSelectExistingNotion}
                          >
                            <CardContent className="flex items-center gap-3 p-3">
                              <SiNotion className="h-5 w-5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">{source.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {`${source.insights.size} insight${source.insights.size !== 1 ? "s" : ""}`}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              )}

              {/* Add New Source */}
              <h4 className="text-sm font-medium text-muted-foreground">
                Add New Source
              </h4>
              <AddConnectionPanel
                onCsvSelect={(file) => {
                  setSourceType("csv-upload");
                  handleCSVUpload(file);
                }}
                csvDescription="Upload a CSV file with headers in the first row."
                csvHelperText="Supports .csv files up to 5MB"
                notion={{
                  apiKey: notionApiKey,
                  showApiKey,
                  onApiKeyChange: setNotionApiKey,
                  onToggleShowApiKey: () => setShowApiKey((prev) => !prev),
                  onConnectNotion: () => {
                    setSourceType("notion");
                    handleConnectNotion();
                  },
                  connectButtonLabel: isLoadingDatabases
                    ? "Connecting..."
                    : "Connect",
                  connectDisabled: !notionApiKey || isLoadingDatabases,
                }}
              />
            </div>
          )}

          {/* Step 2: Insight Configuration (Notion only) */}
          {currentStep === "insight" && sourceType === "notion" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Configure Insight</h3>

              {/* Tab Switcher (only for existing connections) */}
              {isFromExistingConnection && persistedNotionConnection && (
                <Tabs value={insightMode} onValueChange={(v) => setInsightMode(v as "existing" | "new")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="existing">Use Existing Insight</TabsTrigger>
                    <TabsTrigger value="new">Create New Insight</TabsTrigger>
                  </TabsList>

                  {/* Existing Insights List */}
                  <TabsContent value="existing" className="space-y-2">
                    <Label>Select an Insight</Label>
                    <div className="space-y-2">
                      {Array.from(persistedNotionConnection.insights.values()).map(
                        (insight) => (
                          <Card
                            key={insight.id}
                            className={`cursor-pointer transition ${
                              selectedInsightId === insight.id
                                ? "border-primary"
                                : "hover:border-primary"
                            }`}
                            onClick={() =>
                              handleSelectExistingInsight(
                                insight.id,
                                insight.table,
                                insight.dimensions,
                              )
                            }
                          >
                            <CardContent className="flex items-center gap-3 p-3">
                              <FiDatabase className="h-5 w-5 shrink-0 text-muted-foreground" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">{insight.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {`${insight.dimensions.length} properties selected`}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ),
                      )}
                    </div>
                    {selectedInsightId && (
                      <Button
                        onClick={handleCreateNotionVisualization}
                        disabled={selectedPropertyIds.length === 0}
                        className="w-full"
                      >
                        Create Table Visualization
                      </Button>
                    )}
                  </TabsContent>

                  {/* Create New Insight */}
                  <TabsContent value="new" className="space-y-4">
                    {/* Database Picker */}
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

                    {/* Property Selection */}
                    {isLoadingSchema && (
                      <p className="text-sm text-muted-foreground">
                        Loading properties...
                      </p>
                    )}
                    {databaseSchema.length > 0 && !isLoadingSchema && (
                      <div className="space-y-2">
                        <Label>Select Properties</Label>
                        <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                          {databaseSchema.map((prop) => (
                            <label
                              key={prop.id}
                              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                            >
                              <Checkbox
                                checked={selectedPropertyIds.includes(prop.id)}
                                onCheckedChange={() => handleToggleProperty(prop.id)}
                              />
                              <span className="flex-1">{prop.name}</span>
                              <span className="text-xs text-muted-foreground">
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
                  </TabsContent>
                </Tabs>
              )}

              {/* Create New Insight (for new connections) */}
              {!isFromExistingConnection && (
                <div className="space-y-4">
                  {/* Database Picker */}
                  <div className="space-y-2">
                    <Label htmlFor="modal-database-new">Select Database</Label>
                    <Select
                      value={selectedDatabaseId || ""}
                      onValueChange={handleSelectDatabase}
                    >
                      <SelectTrigger id="modal-database-new">
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

                  {/* Property Selection */}
                  {isLoadingSchema && (
                    <p className="text-sm text-muted-foreground">
                      Loading properties...
                    </p>
                  )}
                  {databaseSchema.length > 0 && !isLoadingSchema && (
                    <div className="space-y-2">
                      <Label>Select Properties</Label>
                      <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                        {databaseSchema.map((prop) => (
                          <label
                            key={prop.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                          >
                            <Checkbox
                              checked={selectedPropertyIds.includes(prop.id)}
                              onCheckedChange={() => handleToggleProperty(prop.id)}
                            />
                            <span className="flex-1">{prop.name}</span>
                            <span className="text-xs text-muted-foreground">
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
              )}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Footer Actions */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (currentStep === "insight") {
                setCurrentStep("source");
              }
            }}
            disabled={currentStep === "source"}
          >
            Back
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
