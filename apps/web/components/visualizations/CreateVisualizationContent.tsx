"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrameWithFields } from "@dashframe/csv";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase, NotionProperty } from "@dashframe/notion";
import {
    useDataSourcesStore,
    useDataFramesStore,
    useVisualizationsStore,
    useInsightsStore,
} from "@/lib/stores";
import { isCSVDataSource, isNotionDataSource } from "@/lib/stores/types";
import { FileText, Database, Notion, Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger, Button, Label, Alert, AlertDescription, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dashframe/ui";
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
    const router = useRouter();

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
    const createDraftInsight = useInsightsStore((s) => s.createDraft);
    const addInsight = useInsightsStore((s) => s.addInsight);
    const setInsightDataFrame = useInsightsStore((s) => s.setInsightDataFrame);
    const getAllInsights = useInsightsStore((s) => s.getAll);
    const createDataFrameFromCSV = useDataFramesStore((s) => s.createFromCSV);
    const createDataFrameFromInsight = useDataFramesStore(
        (s) => s.createFromInsight,
    );
    const createVisualization = useVisualizationsStore((s) => s.create);

    // Fetch all existing data sources and insights
    const existingDataSources = getAll();
    const existingInsights = getAllInsights();

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
        (tableId: string, name: string, fieldIds: string[]) => {
            // Create draft insight with all fields selected
            const insightId = createDraftInsight(tableId, name, fieldIds);

            // Navigate to preview screen
            router.push(`/insights/${insightId}/create-visualization`);
            onComplete();
        },
        [createDraftInsight, router, onComplete],
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

                    const tableName = file.name.replace(/\.csv$/i, "");

                    // Generate tableId upfront to use consistently
                    const tableId = crypto.randomUUID();

                    // Convert CSV with field metadata using the real tableId
                    const { dataFrame, fields, sourceSchema } = csvToDataFrameWithFields(
                        result.data,
                        tableId
                    );

                    if (!fields.length) {
                        setError("CSV did not contain any columns.");
                        return;
                    }

                    // Create DataFrame from CSV
                    const dataFrameId = createDataFrameFromCSV(
                        localSource.id,
                        `${tableName} Data`,
                        dataFrame,
                    );

                    // Add DataTable with the pre-generated tableId and correctly-linked fields
                    addDataTable(
                        localSource.id,
                        tableName,
                        file.name,
                        {
                            id: tableId,
                            fields,
                            sourceSchema,
                            dataFrameId,
                        }
                    );

                    // Create draft insight with all fields selected
                    const fieldIds = fields.map((f) => f.id);
                    const insightId = createDraftInsight(tableId, tableName, fieldIds);

                    // Navigate to preview screen
                    router.push(`/insights/${insightId}/create-visualization`);
                    onComplete();
                },
            });
        },
        [
            createDataFrameFromCSV,
            addLocal,
            getLocal,
            addDataTable,
            createDraftInsight,
            router,
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
                // Get existing DataTable from insight
                const existingInsight = getAllInsights().find(
                    (i) => i.id === selectedInsightId,
                );
                // Support both old and new insight structure
                dataTableId = existingInsight?.baseTable?.tableId
                    || existingInsight?.dataTableIds?.[0]
                    || "";
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

            // Navigate to preview screen instead of creating visualization directly
            router.push(`/insights/${insightId}/create-visualization`);
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
                        {/* Existing Insights */}
                        {existingInsights.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-muted-foreground text-sm font-medium">
                                    Existing Insights
                                </h4>
                                <div className="space-y-2">
                                    {existingInsights.map((insight) => {
                                        // Skip insights without baseTable (legacy or incomplete)
                                        if (!insight?.baseTable?.tableId) return null;

                                        // Get the data table info for display
                                        let dataTable = null;
                                        for (const source of existingDataSources) {
                                            const table = source.dataTables.get(insight.baseTable.tableId);
                                            if (table) {
                                                dataTable = table;
                                                break;
                                            }
                                        }

                                        if (!dataTable) return null;

                                        return (
                                            <Card
                                                key={insight.id}
                                                className="hover:border-primary cursor-pointer transition"
                                                onClick={() => {
                                                    router.push(`/insights/${insight.id}/create-visualization`);
                                                    onComplete();
                                                }}
                                            >
                                                <CardContent className="flex items-center gap-3 p-3">
                                                    <Database className="text-muted-foreground h-5 w-5 shrink-0" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="font-medium">{insight.name}</div>
                                                        <div className="text-muted-foreground text-xs">
                                                            {dataTable.name} • {insight.baseTable.selectedFields.length} fields
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Existing Sources */}
                        {existingDataSources.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-muted-foreground text-sm font-medium">
                                    Existing Tables
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
                                                        handleSelectExistingCSV(
                                                            dataTable.id,
                                                            dataTable.name,
                                                            dataTable.fields.map(f => f.id),
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
                        {(existingInsights.length > 0 || existingDataSources.length > 0) && (
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
                                                    // Support both old and new insight structure
                                                    const tableId = insight.baseTable?.tableId;
                                                    if (tableId) {
                                                        return notionConnection.dataTables?.has(tableId) ?? false;
                                                    }
                                                    // Fallback to legacy dataTableIds
                                                    return insight.dataTableIds?.some(
                                                        (dtId) =>
                                                            notionConnection.dataTables?.has(dtId) ?? false,
                                                    ) ?? false;
                                                })
                                                .map((insight) => {
                                                    // Get the DataTable to show info
                                                    const dataTableId = insight.baseTable?.tableId
                                                        || insight.dataTableIds?.[0];
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
