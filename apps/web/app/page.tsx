"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import type { DataFrame } from "@dash-frame/dataframe";
import dynamic from "next/dynamic";

import { csvToDataFrame } from "@dash-frame/csv";
import {
  notionToDataFrame,
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  type NotionDatabase,
  type NotionProperty,
  type NotionConfig,
} from "@dash-frame/notion";
import { buildVegaLiteSpec, type AxisSelection } from "../lib/spec";

// Dynamically import VegaChart with no SSR to prevent Set serialization issues
const VegaChart = dynamic(
  () => import("../components/VegaChart").then((mod) => mod.VegaChart),
  { ssr: false },
);
import {
  persistDataFrame,
  persistAxisSelection,
  readPersistedDataFrame,
  readPersistedAxisSelection,
  persistNotionConfig,
  persistSourceType,
  readPersistedNotionConfig,
  readPersistedSourceType,
  type DataSourceType,
} from "../lib/storage";

type AxisOption = {
  label: string;
  value: string;
};

const formatAxisOption = (
  column: DataFrame["columns"][number],
): AxisOption => ({
  value: column.name,
  label: `${column.name} (${column.type})`,
});

export default function HomePage() {
  const [dataFrame, setDataFrame] = useState<DataFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [axisSelection, setAxisSelection] = useState<AxisSelection>({
    x: null,
    y: null,
  });

  // Source type state
  const [sourceType, setSourceType] = useState<DataSourceType>("csv");

  // Notion-specific state
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

  const axisOptions = useMemo<AxisOption[]>(
    () => dataFrame?.columns.map(formatAxisOption) ?? [],
    [dataFrame],
  );

  const spec = useMemo(
    () => (dataFrame ? buildVegaLiteSpec(dataFrame, axisSelection) : null),
    [dataFrame, axisSelection],
  );

  const resetState = useCallback(() => {
    setDataFrame(null);
    setAxisSelection({ x: null, y: null });
    persistDataFrame(null);
    persistAxisSelection({ x: null, y: null });
    persistNotionConfig(null);
    persistSourceType(null);
    setNotionDatabases([]);
    setSelectedDatabaseId(null);
    setDatabaseSchema([]);
    setSelectedPropertyIds([]);
  }, []);

  const hydrateFromStorage = useCallback(() => {
    // Load source type
    const persistedSourceType = readPersistedSourceType();
    if (persistedSourceType) {
      setSourceType(persistedSourceType);
    }

    // Load Notion config if exists
    const persistedNotionConfig = readPersistedNotionConfig();
    if (persistedNotionConfig) {
      setNotionApiKey(persistedNotionConfig.apiKey);
      setSelectedDatabaseId(persistedNotionConfig.databaseId);
      setSelectedPropertyIds(persistedNotionConfig.selectedPropertyIds || []);
    }

    // Load DataFrame
    const persistedFrame = readPersistedDataFrame();
    if (!persistedFrame) return;

    setDataFrame(persistedFrame);

    const persistedAxes = readPersistedAxisSelection();
    setAxisSelection({
      x:
        persistedAxes.x &&
          persistedFrame.columns.some((column) => column.name === persistedAxes.x)
          ? persistedAxes.x
          : (persistedFrame.columns[0]?.name ?? null),
      y:
        persistedAxes.y &&
          persistedFrame.columns.some((column) => column.name === persistedAxes.y)
          ? persistedAxes.y
          : (persistedFrame.columns.find((column) => column.type === "number")
            ?.name ??
            persistedFrame.columns[1]?.name ??
            persistedFrame.columns[0]?.name ??
            null),
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      hydrateFromStorage();
    });
  }, [hydrateFromStorage]);

  useEffect(() => {
    if (!dataFrame) return;
    persistDataFrame(dataFrame);
  }, [dataFrame]);

  useEffect(() => {
    if (!dataFrame) return;
    persistAxisSelection(axisSelection);
  }, [dataFrame, axisSelection]);

  const handleFile = useCallback(
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
            resetState();
            return;
          }

          const parsedDataFrame = csvToDataFrame(result.data);

          if (!parsedDataFrame.columns.length) {
            setError("CSV did not contain any columns.");
            resetState();
            return;
          }

          setDataFrame(parsedDataFrame);
          setSourceType("csv");
          persistSourceType("csv");
          setAxisSelection({
            x: parsedDataFrame.columns[0]?.name ?? null,
            y:
              parsedDataFrame.columns.find((column) => column.type === "number")
                ?.name ??
              parsedDataFrame.columns[1]?.name ??
              parsedDataFrame.columns[0]?.name ??
              null,
          });
        },
      });
    },
    [resetState],
  );

  // Notion handlers
  const handleConnectNotion = useCallback(async () => {
    if (!notionApiKey.trim()) {
      setError("Please enter a Notion API key");
      return;
    }

    setError(null);
    setIsLoadingDatabases(true);

    try {
      const databases = await fetchNotionDatabases(notionApiKey);
      setNotionDatabases(databases);

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
  }, [notionApiKey]);

  const handleSelectDatabase = useCallback(
    async (databaseId: string) => {
      if (!notionApiKey) return;

      setSelectedDatabaseId(databaseId);
      setError(null);
      setIsLoadingSchema(true);

      try {
        const schema = await fetchNotionDatabaseSchema(notionApiKey, databaseId);
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
    [notionApiKey],
  );

  const handleToggleProperty = useCallback((propertyId: string) => {
    setSelectedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    );
  }, []);

  const handleImportNotion = useCallback(async () => {
    if (!notionApiKey || !selectedDatabaseId || selectedPropertyIds.length === 0) {
      setError("Please select a database and at least one property");
      return;
    }

    setError(null);
    setIsImporting(true);

    try {
      const config: NotionConfig = {
        apiKey: notionApiKey,
        databaseId: selectedDatabaseId,
        selectedPropertyIds,
      };

      const dataFrame = await notionToDataFrame(config);

      if (!dataFrame.columns.length) {
        setError("No data found in the selected database");
        return;
      }

      setDataFrame(dataFrame);
      setSourceType("notion");
      persistSourceType("notion");
      persistNotionConfig(config);

      setAxisSelection({
        x: dataFrame.columns[0]?.name ?? null,
        y:
          dataFrame.columns.find((column) => column.type === "number")?.name ??
          dataFrame.columns[1]?.name ??
          dataFrame.columns[0]?.name ??
          null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import from Notion",
      );
    } finally {
      setIsImporting(false);
    }
  }, [notionApiKey, selectedDatabaseId, selectedPropertyIds]);

  const handleRefresh = useCallback(async () => {
    if (sourceType === "notion") {
      await handleImportNotion();
    }
  }, [sourceType, handleImportNotion]);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-slate-950 p-6 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">DashFrame</h1>
        <p className="text-sm text-slate-400">
          Import data from CSV or Notion to explore the DataFrame → Vega-Lite
          preview pipeline.
        </p>
      </header>

      <section className="grid flex-1 gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
          {/* Source Type Selector */}
          <div className="flex gap-2 rounded-md border border-slate-700 bg-slate-800/50 p-1">
            <button
              onClick={() => setSourceType("csv")}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium transition ${sourceType === "csv"
                  ? "bg-slate-700 text-slate-50"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              CSV File
            </button>
            <button
              onClick={() => setSourceType("notion")}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium transition ${sourceType === "notion"
                  ? "bg-slate-700 text-slate-50"
                  : "text-slate-400 hover:text-slate-200"
                }`}
            >
              Notion DB
            </button>
          </div>

          {/* CSV Upload UI */}
          {sourceType === "csv" && (
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
                    if (file) handleFile(file);
                  }}
                />
              </label>
            </>
          )}

          {/* Notion Connection UI */}
          {sourceType === "notion" && (
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
                          <span className="text-xs text-slate-500">{prop.type}</span>
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

          {error ? (
            <pre className="overflow-auto rounded-md border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </pre>
          ) : null}

          {dataFrame ? (
            <div className="space-y-4 text-sm text-slate-300">
              <div className="space-y-1">
                <label className="block text-xs font-semibold uppercase text-slate-400">
                  X Axis
                </label>
                <select
                  value={axisSelection.x ?? ""}
                  onChange={(event) =>
                    setAxisSelection((current) => ({
                      ...current,
                      x: event.target.value || null,
                    }))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  {axisOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold uppercase text-slate-400">
                  Y Axis
                </label>
                <select
                  value={axisSelection.y ?? ""}
                  onChange={(event) =>
                    setAxisSelection((current) => ({
                      ...current,
                      y: event.target.value || null,
                    }))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  {axisOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Quantitative columns work best on the Y axis. Temporal values
                  render as a line chart.
                </p>
              </div>

              <div className="space-y-2 text-xs text-slate-400">
                <p>
                  <span className="font-semibold text-slate-200">Rows:</span>{" "}
                  {dataFrame.rows.length.toLocaleString()}
                </p>
                <p>
                  <span className="font-semibold text-slate-200">Columns:</span>{" "}
                  {dataFrame.columns.length}
                </p>
                <div>
                  <span className="font-semibold text-slate-200">
                    Detected types:
                  </span>
                  <ul className="mt-1 space-y-1">
                    {dataFrame.columns.map((column) => (
                      <li key={column.name} className="flex items-center gap-2">
                        <span className="rounded bg-slate-800 px-2 py-1 text-[10px] uppercase text-slate-300">
                          {column.type}
                        </span>
                        <span className="text-slate-200">{column.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
        </aside>

        <section className="flex min-h-[480px] flex-col gap-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-50">Chart Preview</h2>
            <div className="flex items-center gap-3">
              {dataFrame && sourceType === "notion" && (
                <button
                  onClick={handleRefresh}
                  disabled={isImporting}
                  className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 disabled:opacity-50"
                >
                  {isImporting ? "Refreshing..." : "Refresh"}
                </button>
              )}
              {dataFrame ? (
                <span className="text-xs text-slate-400">
                  Rows: {dataFrame.rows.length.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>

          {spec && dataFrame ? (
            <VegaChart
              spec={{
                ...spec,
                data: { values: dataFrame.rows },
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-700 text-sm text-slate-500">
              Upload a CSV and choose chart axes to render a Vega-Lite preview.
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
