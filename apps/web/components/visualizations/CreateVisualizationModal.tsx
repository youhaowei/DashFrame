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
import { Select } from "../fields";

// ============================================================================
// Reusable UI Components
// ============================================================================

interface SelectableCardProps {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  isSelected?: boolean;
}

function SelectableCard({
  onClick,
  icon,
  title,
  subtitle,
  isSelected = false,
}: SelectableCardProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
        isSelected
          ? "border-blue-600 bg-blue-50"
          : "border-gray-300 hover:border-blue-500 hover:bg-blue-50"
      }`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900">{title}</div>
        {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
      </div>
    </button>
  );
}

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ isActive, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
        isActive
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

interface SectionProps {
  title?: string;
  children: React.ReactNode;
  bordered?: boolean;
}

function Section({ title, children, bordered = false }: SectionProps) {
  return (
    <div className={bordered ? "space-y-3 rounded-lg border border-gray-300 p-4" : "space-y-3"}>
      {title && <h4 className="font-medium text-gray-900">{title}</h4>}
      {children}
    </div>
  );
}

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
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
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
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
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
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">
            Create Visualization
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Step Content */}
        <div className="mb-6 min-h-[400px]">
          {/* Step 1: Source Selection */}
          {currentStep === "source" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Choose Data Source
              </h3>

              {/* Existing Sources */}
              {existingDataSources.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-gray-700">
                    Existing Sources
                  </h4>
                  <div className="space-y-2">
                    {existingDataSources.map((source) => {
                      if (isCSVDataSource(source)) {
                        return (
                          <SelectableCard
                            key={source.id}
                            onClick={() =>
                              handleSelectExistingCSV(
                                source.id,
                                source.dataFrameId,
                                source.name,
                              )
                            }
                            icon={<FiFileText className="h-5 w-5 shrink-0 text-gray-600" />}
                            title={source.name}
                            subtitle={source.fileName}
                          />
                        );
                      } else if (isNotionDataSource(source)) {
                        return (
                          <SelectableCard
                            key={source.id}
                            onClick={handleSelectExistingNotion}
                            icon={<SiNotion className="h-5 w-5 shrink-0 text-gray-900" />}
                            title={source.name}
                            subtitle={`${source.insights.size} insight${source.insights.size !== 1 ? "s" : ""}`}
                          />
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              )}

              {/* Add New Source */}
              <h4 className="text-sm font-medium text-gray-700">
                Add New Source
              </h4>

              {/* CSV Upload */}
              <Section title="CSV File" bordered>
                <p className="text-sm text-gray-600">
                  Upload a CSV file with headers in the first row
                </p>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center hover:border-blue-500 hover:bg-blue-50">
                  <span className="text-sm font-medium text-gray-700">
                    Select CSV File
                  </span>
                  <span className="mt-1 text-xs text-gray-500">
                    Supports .csv files up to 5MB
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setSourceType("csv-upload");
                        handleCSVUpload(file);
                      }
                    }}
                  />
                </label>
              </Section>

              {/* Notion */}
              <Section title="Notion Database" bordered>
                <p className="text-sm text-gray-600">
                  Connect to your Notion workspace
                </p>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={notionApiKey}
                      onChange={(e) => setNotionApiKey(e.target.value)}
                      placeholder="secret_..."
                      className="w-full rounded-md border border-gray-300 px-3 py-2 pr-16 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-600 hover:text-gray-900"
                    >
                      {showApiKey ? "Hide" : "Show"}
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setSourceType("notion");
                      handleConnectNotion();
                    }}
                    disabled={!notionApiKey || isLoadingDatabases}
                    className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isLoadingDatabases ? "Connecting..." : "Connect"}
                  </button>
                </div>
              </Section>
            </div>
          )}

          {/* Step 2: Insight Configuration (Notion only) */}
          {currentStep === "insight" && sourceType === "notion" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Configure Insight
              </h3>

              {/* Tab Switcher (only for existing connections) */}
              {isFromExistingConnection && persistedNotionConnection && (
                <div className="flex gap-2">
                  <TabButton
                    isActive={insightMode === "existing"}
                    onClick={() => setInsightMode("existing")}
                  >
                    Use Existing Insight
                  </TabButton>
                  <TabButton
                    isActive={insightMode === "new"}
                    onClick={() => setInsightMode("new")}
                  >
                    Create New Insight
                  </TabButton>
                </div>
              )}

              {/* Existing Insights List */}
              {insightMode === "existing" && persistedNotionConnection && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Select an Insight
                  </label>
                  <div className="space-y-2">
                    {Array.from(persistedNotionConnection.insights.values()).map(
                      (insight) => (
                        <SelectableCard
                          key={insight.id}
                          onClick={() =>
                            handleSelectExistingInsight(
                              insight.id,
                              insight.table,
                              insight.dimensions,
                            )
                          }
                          icon={<FiDatabase className="h-5 w-5 shrink-0 text-gray-600" />}
                          title={insight.name}
                          subtitle={`${insight.dimensions.length} properties selected`}
                          isSelected={selectedInsightId === insight.id}
                        />
                      ),
                    )}
                  </div>
                  {selectedInsightId && (
                    <button
                      onClick={handleCreateNotionVisualization}
                      disabled={selectedPropertyIds.length === 0}
                      className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Create Table Visualization
                    </button>
                  )}
                </div>
              )}

              {/* Create New Insight */}
              {insightMode === "new" && (
                <div className="space-y-4">
                  {/* Database Picker */}
                  <Select
                    label="Select Database"
                    value={selectedDatabaseId || ""}
                    onChange={handleSelectDatabase}
                    options={notionDatabases.map((db) => ({
                      label: db.title,
                      value: db.id,
                    }))}
                    placeholder="Choose a database..."
                  />

                  {/* Property Selection */}
                  {isLoadingSchema && (
                    <p className="text-sm text-gray-600">
                      Loading properties...
                    </p>
                  )}
                  {databaseSchema.length > 0 && !isLoadingSchema && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Select Properties
                      </label>
                      <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-gray-300 p-2">
                        {databaseSchema.map((prop) => (
                          <label
                            key={prop.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100"
                          >
                            <input
                              type="checkbox"
                              checked={selectedPropertyIds.includes(prop.id)}
                              onChange={() => handleToggleProperty(prop.id)}
                              className="rounded border-gray-300"
                            />
                            <span className="flex-1 text-gray-900">
                              {prop.name}
                            </span>
                            <span className="text-xs text-gray-500">
                              {prop.type}
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={handleCreateNotionVisualization}
                        disabled={selectedPropertyIds.length === 0}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Create Table Visualization
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-between">
          <button
            onClick={() => {
              if (currentStep === "insight") {
                setCurrentStep("source");
              }
            }}
            disabled={currentStep === "source"}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
