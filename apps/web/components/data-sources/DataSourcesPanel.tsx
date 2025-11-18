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

          // Generate UUID for data source
          const dataSourceId = crypto.randomUUID();

          // Create DataFrame first (with dataSourceId reference)
          const dataFrameId = createDataFrameFromCSV(
            dataSourceId,
            `${file.name} Data`,
            dataFrame,
          );

          // Create CSV data source (with dataFrameId reference)
          addCSV(
            file.name.replace(/\.csv$/i, ""),
            file.name,
            file.size,
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
            // Remove data field from spec (will be added during render)
            const { data, ...specWithoutData } = defaultSpec;

            createVisualization(
              {
                dataFrameId,
              },
              `${file.name} Chart`,
              specWithoutData,
            );
          }
        },
      });
    },
    [addCSV, createDataFrameFromCSV, createVisualization],
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

      // Create DataFrame from insight
      const dataFrameId = createDataFrameFromInsight(
        notionSource.id,
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
        const { data, ...specWithoutData } = defaultSpec;

        createVisualization(
          {
            dataFrameId,
            dataSourceId: notionSource.id,
            insightId,
          },
          "Notion Chart",
          specWithoutData,
        );
      }
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
    createDataFrameFromInsight,
    createVisualization,
  ]);

  return (
    <aside className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
      {/* Tab Selector */}
      <div className="flex gap-2 rounded-md border border-slate-700 bg-slate-800/50 p-1">
        <button
          onClick={() => setActiveTab("csv")}
          className={`flex-1 rounded px-3 py-2 text-sm font-medium transition ${
            activeTab === "csv"
              ? "bg-slate-700 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          CSV File
        </button>
        <button
          onClick={() => setActiveTab("notion")}
          className={`flex-1 rounded px-3 py-2 text-sm font-medium transition ${
            activeTab === "notion"
              ? "bg-slate-700 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Notion DB
        </button>
      </div>

      {/* CSV Upload Section */}
      {activeTab === "csv" && (
        <>
          <h2 className="text-lg font-medium text-slate-50">Upload CSV</h2>
          <p className="text-sm text-slate-400">
            Choose a CSV file with headers in the first row. The preview
            automatically infers column types.
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-slate-600 bg-slate-800/70 p-6 text-center text-sm font-medium text-slate-100 shadow-md transition hover:border-slate-400 hover:bg-slate-800/90">
            <span>Select CSV</span>
            <span className="mt-2 text-xs font-normal text-slate-300">
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
        </>
      )}

      {/* Notion Connection Section */}
      {activeTab === "notion" && (
        <>
          <h2 className="text-lg font-medium text-slate-50">
            Connect to Notion
          </h2>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="block text-sm text-slate-400">
                API Key
                <span className="ml-1 text-xs text-yellow-400">
                  (stored in browser)
                </span>
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={notionApiKey}
                  onChange={(e) => setNotionApiKey(e.target.value)}
                  placeholder="secret_..."
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 pr-20 text-sm"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Create an integration at{" "}
                <a
                  href="https://www.notion.so/my-integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  notion.so/my-integrations
                </a>
              </p>
            </div>

            <button
              onClick={handleConnectNotion}
              disabled={!notionApiKey || isLoadingDatabases}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoadingDatabases ? "Connecting..." : "Connect"}
            </button>

            {/* Database Picker */}
            {notionDatabases.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm text-slate-400">
                  Select Database
                </label>
                <select
                  value={selectedDatabaseId || ""}
                  onChange={(e) => handleSelectDatabase(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  <option value="">Choose a database...</option>
                  {notionDatabases.map((db) => (
                    <option key={db.id} value={db.id}>
                      {db.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Property Selection */}
            {isLoadingSchema && (
              <p className="text-sm text-slate-400">Loading properties...</p>
            )}
            {databaseSchema.length > 0 && !isLoadingSchema && (
              <div className="space-y-2">
                <label className="block text-sm text-slate-400">
                  Select Properties
                </label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-2">
                  {databaseSchema.map((prop) => (
                    <label
                      key={prop.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPropertyIds.includes(prop.id)}
                        onChange={() => handleToggleProperty(prop.id)}
                        className="rounded border-slate-600"
                      />
                      <span className="flex-1 text-slate-200">{prop.name}</span>
                      <span className="text-xs text-slate-500">
                        {prop.type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Import Button */}
            {selectedDatabaseId && selectedPropertyIds.length > 0 && (
              <button
                onClick={handleImportNotion}
                disabled={isImporting}
                className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                {isImporting ? "Importing..." : "Import Data"}
              </button>
            )}
          </div>
        </>
      )}

      {/* Error Display */}
      {error && (
        <pre className="overflow-auto rounded-md border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
        </pre>
      )}
    </aside>
  );
}
