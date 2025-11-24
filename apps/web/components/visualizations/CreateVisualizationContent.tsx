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
    useInsightsStore,
} from "@/lib/stores";
import { isCSVDataSource, isNotionDataSource } from "@/lib/stores/types";
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

    const [notionApiKey, setNotionApiKey] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const [notionDatabases, setNotionDatabases] = useState<NotionDatabase[]>([]);
    const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(
        null
    );
    const [databaseSchema, setDatabaseSchema] = useState<NotionProperty[]>([]);
    const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
    const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
    const [isLoadingSchema, setIsLoadingSchema] = useState(false);
    const [insightMode, setInsightMode] = useState<"existing" | "new">("new");
    const [selectedInsightId, setSelectedInsightId] = useState<string | null>(
        null
    );
    const [isFromExistingConnection, setIsFromExistingConnection] =
        useState(false);
    const [showNotionConfig, setShowNotionConfig] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        (s) => s.createFromInsight
    );
    const existingDataSources = getAll();
    const existingInsights = getAllInsights();

    const notionConnection = getNotion();
    const notionInsightsForConnection = notionConnection
        ? existingInsights
            .filter((insight) => {
                const tableId = insight.baseTable?.tableId;
                if (tableId) {
                    return notionConnection.dataTables?.has(tableId) ?? false;
                }
                return insight.dataTableIds?.some((dtId) =>
                    notionConnection.dataTables?.has(dtId)
                );
            })
            .map((insight) => {
                const dataTableId =
                    insight.baseTable?.tableId || insight.dataTableIds?.[0];
                const dataTable = dataTableId
                    ? notionConnection.dataTables?.get(dataTableId)
                    : null;
                return { insight, dataTable };
            })
        : [];

    const listDatabasesMutation = trpc.notion.listDatabases.useMutation();
    const getDatabaseSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();
    const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();

    useEffect(() => {
        const persistedConnection = getNotion();
        setNotionApiKey(persistedConnection?.apiKey ?? "");
    }, [getNotion]);

    const handleSelectExistingCSV = useCallback(
        (tableId: string, name: string, fieldIds: string[]) => {
            const insightId = createDraftInsight(tableId, name, fieldIds);
            router.push(`/insights/${insightId}/create-visualization`);
            onComplete();
        },
        [createDraftInsight, router, onComplete]
    );

    const fetchNotionDatabases = useCallback(async () => {
        const notionConnection = getNotion();
        if (!notionConnection) return;

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
                    : "Failed to load Notion databases"
            );
        } finally {
            setIsLoadingDatabases(false);
        }
    }, [getNotion, listDatabasesMutation]);

    const handleSelectExistingNotion = useCallback(async () => {
        setIsFromExistingConnection(true);
        setInsightMode("existing");
        setShowNotionConfig(true);
        await fetchNotionDatabases();
    }, [fetchNotionDatabases]);

    const handleCSVUpload = useCallback(
        (file: File) => {
            setError(null);

            Papa.parse(file, {
                dynamicTyping: false,
                skipEmptyLines: true,
                complete: (result: ParseResult<string>) => {
                    if (result.errors.length) {
                        setError(
                            result.errors
                                .map((err: ParseError) => err.message)
                                .join("\n")
                        );
                        return;
                    }

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
                    const tableId = crypto.randomUUID();

                    const { dataFrame, fields, sourceSchema } =
                        csvToDataFrameWithFields(result.data, tableId);

                    if (!fields.length) {
                        setError("CSV did not contain any columns.");
                        return;
                    }

                    const dataFrameId = createDataFrameFromCSV(
                        localSource.id,
                        `${tableName} Data`,
                        dataFrame
                    );

                    addDataTable(localSource.id, tableName, file.name, {
                        id: tableId,
                        fields,
                        sourceSchema,
                        dataFrameId,
                    });

                    const fieldIds = fields.map((f) => f.id);
                    const insightId = createDraftInsight(tableId, tableName, fieldIds);

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
        ]
    );

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
            setNotion("Notion", notionApiKey);

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
    }, [notionApiKey, listDatabasesMutation, setNotion]);

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
        [notionApiKey, getDatabaseSchemaMutation]
    );

    const handleToggleProperty = useCallback((propertyId: string) => {
        setSelectedPropertyIds((current) =>
            current.includes(propertyId)
                ? current.filter((id) => id !== propertyId)
                : [...current, propertyId]
        );
    }, []);

    const handleSelectExistingInsight = useCallback(
        async (insightId: string, databaseId: string, propertyIds: string[]) => {
            setSelectedInsightId(insightId);
            setSelectedDatabaseId(databaseId);
            setSelectedPropertyIds(propertyIds);

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
                            : "Failed to fetch database schema"
                    );
                } finally {
                    setIsLoadingSchema(false);
                }
            }
        },
        [notionApiKey, getDatabaseSchemaMutation]
    );

    const handleCreateNotionVisualization = useCallback(async () => {
        if (!selectedDatabaseId || selectedPropertyIds.length === 0) return;

        setError(null);

        try {
            const notionSource = getNotion();
            if (!notionSource) {
                setError("Notion connection not found");
                return;
            }

            let insightId: string;
            let dataTableId: string;

            if (insightMode === "existing" && selectedInsightId) {
                insightId = selectedInsightId;
                const existingInsight = getAllInsights().find(
                    (i) => i.id === selectedInsightId
                );
                dataTableId =
                    existingInsight?.baseTable?.tableId ||
                    existingInsight?.dataTableIds?.[0] ||
                    "";
            } else {
                dataTableId = addDataTable(
                    notionSource.id,
                    `${selectedDatabaseId} Table`,
                    selectedDatabaseId
                );

                insightId = addInsight(
                    `${selectedDatabaseId} Insight`,
                    [dataTableId],
                    "transform"
                );
            }

            const dataFrame = await queryDatabaseMutation.mutateAsync({
                apiKey: notionApiKey,
                databaseId: selectedDatabaseId,
                selectedPropertyIds,
            });

            if (!dataFrame.columns || !dataFrame.columns.length) {
                setError("No data found in the selected database");
                return;
            }

            const dataFrameId = createDataFrameFromInsight(
                insightId,
                "Notion Data",
                dataFrame
            );

            setInsightDataFrame(insightId, dataFrameId);

            updateDataTable(notionSource.id, dataTableId, {
                dataFrameId,
                lastFetchedAt: Date.now(),
            });

            router.push(`/insights/${insightId}/create-visualization`);
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
        getNotion,
        addDataTable,
        addInsight,
        getAllInsights,
        setInsightDataFrame,
        queryDatabaseMutation,
        notionApiKey,
        createDataFrameFromInsight,
        updateDataTable,
        router,
        onComplete,
    ]);

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
                {isFromExistingConnection && getNotion() && (
                    <Tabs
                        value={insightMode}
                        onValueChange={(value) =>
                            setInsightMode(value as "existing" | "new")
                        }
                    >
                        <TabsList className="grid w-full grid-cols-2 gap-2">
                            <TabsTrigger value="existing">Use Existing Insight</TabsTrigger>
                            <TabsTrigger value="new">Create New Insight</TabsTrigger>
                        </TabsList>

                        <TabsContent value="existing" className="space-y-3 pt-2">
                            <Label className="text-xs font-medium text-muted-foreground">
                                Select an Insight
                            </Label>
                            <div className="space-y-2">
                                {notionInsightsForConnection.map(({ insight, dataTable }) => (
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
                                                []
                                            )
                                        }
                                    >
                                        <CardContent className="flex items-center gap-3 p-3">
                                            <Database className="text-muted-foreground h-5 w-5 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <div className="font-medium">{insight.name}</div>
                                                <div className="text-muted-foreground text-xs">
                                                    {dataTable
                                                        ? `${dataTable.fields.length} properties selected`
                                                        : "No table configured"}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
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

                        <TabsContent value="new" className="space-y-3 pt-2">
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

                {!isFromExistingConnection && (
                    <div className="space-y-3">
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
            </CardContent>
        </Card>
    ) : null;

    const existingInsightsSection = existingInsights.length > 0 ? (
        <section className="space-y-3">
            <h4 className="text-muted-foreground text-sm font-medium">
                Existing Insights
            </h4>
            <div className="grid gap-3">
                {existingInsights.map((insight) => {
                    if (!insight?.baseTable?.tableId) {
                        return null;
                    }

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
                                        {dataTable.name} •{" "}
                                        {insight.baseTable.selectedFields.length} fields
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </section>
    ) : null;

    const existingTableCards = existingDataSources.flatMap((source) => {
        if (isCSVDataSource(source)) {
            return Array.from(source.dataTables?.values() ?? []).map((dataTable) => {
                const fieldIds = dataTable.fields.map((f) => f.id);

                return (
                    <Card
                        key={dataTable.id}
                        className="hover:border-primary cursor-pointer transition"
                        onClick={() =>
                            handleSelectExistingCSV(dataTable.id, dataTable.name, fieldIds)
                        }
                    >
                        <CardContent className="flex items-center gap-3 p-3">
                            <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="font-medium">{dataTable.name}</div>
                                <div className="text-muted-foreground text-xs">
                                    {dataTable.table} • {dataTable.fields.length} columns
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                );
            });
        }

        if (isNotionDataSource(source)) {
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
                                {`${source.dataTables?.size ?? 0} table${(source.dataTables?.size ?? 0) !== 1 ? "s" : ""
                                    }`}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            );
        }

        return [];
    });

    const existingTablesSection = existingTableCards.length > 0 ? (
        <section className="space-y-3">
            <h4 className="text-muted-foreground text-sm font-medium">
                Existing Tables
            </h4>
            <div className="grid gap-3">{existingTableCards}</div>
        </section>
    ) : null;

    const addNewSourceSection = (
        <section className="space-y-3">
            <h4 className="text-muted-foreground text-sm font-medium">
                Add New Source
            </h4>
            <AddConnectionPanel
                onCsvSelect={(file) => {
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
                        handleConnectNotion();
                    },
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
                {existingTablesSection}
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
