"use client";

import { useState, useCallback, useEffect } from "react";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrame } from "@dashframe/csv";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase, NotionProperty } from "@dashframe/notion";
import {
    useDataSourcesStore,
    useDataFramesStore,
    useVisualizationsStore,
    useInsightsStore,
} from "@/lib/stores";
import { isCSVDataSource, isNotionDataSource } from "@/lib/stores/types";
import type { TopLevelSpec } from "vega-lite";
import { FileText, Database, Notion } from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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

interface CreateVisualizationContentProps {
    onComplete: () => void;
    onCancel?: () => void;
}

type Step = "source" | "insight";
type SourceType = "csv-upload" | "csv-existing" | "notion";

export function CreateVisualizationContent({
    onComplete,
    onCancel,
}: CreateVisualizationContentProps) {
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
    const addLocal = useDataSourcesStore((s) => s.addLocal);
    const getLocal = useDataSourcesStore((s) => s.getLocal);
    const setNotion = useDataSourcesStore((s) => s.setNotion);
    const getNotion = useDataSourcesStore((s) => s.getNotion);
    const getAll = useDataSourcesStore((s) => s.getAll);
    const addDataTable = useDataSourcesStore((s) => s.addDataTable);
    const updateDataTable = useDataSourcesStore((s) => s.updateDataTable);
    const addInsight = useInsightsStore((s) => s.addInsight);
    const setInsightDataFrame = useInsightsStore((s) => s.setInsightDataFrame);
    const getAllInsights = useInsightsStore((s) => s.getAll);
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
        const persistedConnection = getNotion();
        setNotionApiKey(persistedConnection?.apiKey ?? "");
    }, [getNotion]);

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

            onComplete();
        },
        [createVisualization, onComplete],
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
    const handleCSVUpload = useCallback(
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

                    if (!dataFrame.columns || !dataFrame.columns.length) {
                        setError("CSV did not contain any columns.");
                        return;
                    }

                    // Get or create local data source
                    let localSource = getLocal();
                    if (!localSource) {
                        addLocal("Local Storage");
                        localSource = getLocal();
                    }

                    if (!localSource) {
                        setError("Failed to create local data source");
                        return;
                    }

                    // Create DataFrame from CSV
                    const dataFrameId = createDataFrameFromCSV(
                        localSource.id,
                        `${file.name} Data`,
                        dataFrame,
                    );

                    // Create DataTable for this CSV file
                    addDataTable(
                        localSource.id,
                        file.name.replace(/\.csv$/i, ""),
                        file.name,
                        {
                            dataFrameId,
                        }
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

                    onComplete();
                },
            });
        },
        [
            createDataFrameFromCSV,
            addLocal,
            getLocal,
            addDataTable,
            createVisualization,
            onComplete,
        ],
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
            let dataTableId: string;

            if (insightMode === "existing" && selectedInsightId) {
                // Reuse existing insight
                insightId = selectedInsightId;
                // Get existing DataTable from insight (assumes first one)
                const existingInsight = getAllInsights().find(
                    (i) => i.id === selectedInsightId,
                );
                dataTableId = existingInsight?.dataTableIds[0] || "";
            } else {
                // Create new DataTable (Notion database configuration)
                dataTableId = addDataTable(
                    notionSource.id,
                    `${selectedDatabaseId} Table`,
                    selectedDatabaseId,
                );

                // Create pass-through Insight for this DataTable
                insightId = addInsight(
                    `${selectedDatabaseId} Insight`,
                    [dataTableId],
                    "transform", // Notion uses transform (operates on cached data)
                );
            }

            // Fetch data
            const dataFrame = await queryDatabaseMutation.mutateAsync({
                apiKey: notionApiKey,
                databaseId: selectedDatabaseId,
                selectedPropertyIds,
            });

            if (!dataFrame.columns || !dataFrame.columns.length) {
                setError("No data found in the selected database");
                return;
            }

            // Create DataFrame from insight
            const dataFrameId = createDataFrameFromInsight(
                insightId,
                "Notion Data",
                dataFrame,
            );

            // Link DataFrame to Insight
            setInsightDataFrame(insightId, dataFrameId);

            // Cache DataFrame in DataTable for future access
            updateDataTable(notionSource.id, dataTableId, {
                dataFrameId,
                lastFetchedAt: Date.now(),
            });

            // Create a minimal Vega-Lite spec (will be built dynamically by VisualizationDisplay)
            const emptySpec: Omit<TopLevelSpec, "data"> = {
                $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            };

            createVisualization(
                {
                    dataFrameId,
                    insightId,
                },
                `Notion - table`,
                emptySpec,
                "table",
            );

            onComplete();
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
        addDataTable,
        addInsight,
        getAllInsights,
        setInsightDataFrame,
        queryDatabaseMutation,
        notionApiKey,
        createDataFrameFromInsight,
        createVisualization,
        updateDataTable,
        onComplete,
    ]);

    return (
        <div className="flex h-full flex-col">
            {/* Step Content */}
            <div className="min-h-[400px] flex-1">
                {/* Step 1: Source Selection */}
                {currentStep === "source" && (
                    <div className="space-y-4">
                        {/* Existing Sources */}
                        {existingDataSources.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-muted-foreground text-sm font-medium">
                                    Existing Sources
                                </h4>
                                <div className="space-y-2">
                                    {existingDataSources.map((source) => {
                                        if (isCSVDataSource(source)) {
                                            // Local source - show each DataTable
                                            return Array.from(
                                                source.dataTables?.values() ?? [],
                                            ).map((dataTable) => (
                                                <Card
                                                    key={dataTable.id}
                                                    className="hover:border-primary cursor-pointer transition"
                                                    onClick={() =>
                                                        dataTable.dataFrameId &&
                                                        handleSelectExistingCSV(
                                                            source.id,
                                                            dataTable.dataFrameId,
                                                            dataTable.name,
                                                        )
                                                    }
                                                >
                                                    <CardContent className="flex items-center gap-3 p-3">
                                                        <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-medium">
                                                                {dataTable.name}
                                                            </div>
                                                            <div className="text-muted-foreground text-xs">
                                                                {dataTable.table} •{" "}
                                                                {dataTable.fields.length} columns
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ));
                                        } else if (isNotionDataSource(source)) {
                                            return (
                                                <Card
                                                    key={source.id}
                                                    className="hover:border-primary cursor-pointer transition"
                                                    onClick={handleSelectExistingNotion}
                                                >
                                                    <CardContent className="flex items-center gap-3 p-3">
                                                        <Notion className="h-5 w-5 shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-medium">{source.name}</div>
                                                            <div className="text-muted-foreground text-xs">
                                                                {`${source.dataTables?.size ?? 0} table${(source.dataTables?.size ?? 0) !== 1 ? "s" : ""}`}
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
                        {existingDataSources.length > 0 && (
                            <h4 className="text-muted-foreground text-sm font-medium">
                                Add New Source
                            </h4>
                        )}
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
                        {/* Tab Switcher (only for existing connections) */}
                        {isFromExistingConnection && getNotion() && (
                            <Tabs
                                value={insightMode}
                                onValueChange={(v) => setInsightMode(v as "existing" | "new")}
                            >
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="existing">
                                        Use Existing Insight
                                    </TabsTrigger>
                                    <TabsTrigger value="new">Create New Insight</TabsTrigger>
                                </TabsList>

                                {/* Existing Insights List */}
                                <TabsContent value="existing" className="space-y-2">
                                    <Label>Select an Insight</Label>
                                    <div className="space-y-2">
                                        {(() => {
                                            const notionConnection = getNotion();
                                            if (!notionConnection) return null;
                                            return getAllInsights()
                                                .filter((insight) => {
                                                    // Only show insights that reference DataTables from this Notion source
                                                    return insight.dataTableIds.some(
                                                        (dtId) =>
                                                            notionConnection.dataTables?.has(dtId) ?? false,
                                                    );
                                                })
                                                .map((insight) => {
                                                    // Get the first DataTable to show info
                                                    const dataTableId = insight.dataTableIds[0];
                                                    const dataTable = dataTableId
                                                        ? notionConnection.dataTables?.get(dataTableId)
                                                        : null;

                                                    return (
                                                        <Card
                                                            key={insight.id}
                                                            className={`cursor-pointer transition ${selectedInsightId === insight.id
                                                                ? "border-primary"
                                                                : "hover:border-primary"
                                                                }`}
                                                            onClick={() =>
                                                                handleSelectExistingInsight(
                                                                    insight.id,
                                                                    dataTable?.table || "",
                                                                    [],
                                                                )
                                                            }
                                                        >
                                                            <CardContent className="flex items-center gap-3 p-3">
                                                                <Database className="text-muted-foreground h-5 w-5 shrink-0" />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="font-medium">
                                                                        {insight.name}
                                                                    </div>
                                                                    <div className="text-muted-foreground text-xs">
                                                                        {dataTable
                                                                            ? `${dataTable.fields.length} properties selected`
                                                                            : "No table configured"}
                                                                    </div>
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    );
                                                });
                                        })()}
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
                                                            onCheckedChange={() =>
                                                                handleToggleProperty(prop.id)
                                                            }
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
                                                        onCheckedChange={() =>
                                                            handleToggleProperty(prop.id)
                                                        }
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
                        )}
                    </div>
                )}
            </div>

            {/* Error Display */}
            {error && (
                <Alert variant="destructive" className="mt-4">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Footer Actions */}
            <div className="mt-6 flex justify-between">
                {currentStep !== "source" ? (
                    <Button
                        variant="outline"
                        onClick={() => {
                            if (currentStep === "insight") {
                                setCurrentStep("source");
                            }
                        }}
                    >
                        Back
                    </Button>
                ) : (
                    <div /> /* Spacer */
                )}
                {onCancel && (
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
            </div>
        </div>
    );
}
