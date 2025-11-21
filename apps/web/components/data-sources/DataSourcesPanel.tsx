"use client";

import { useState, useCallback, useEffect } from "react";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrameWithFields } from "@dashframe/csv";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase, NotionProperty } from "@dashframe/notion";
import type { Field, SourceSchema } from "@dashframe/dataframe";
import {
  useDataSourcesStore,
  useDataFramesStore,
  useVisualizationsStore,
} from "@/lib/stores";
import { buildVegaLiteSpec } from "@/lib/spec";
import type { TopLevelSpec } from "vega-lite";
import type { DataFrame } from "@dashframe/dataframe";
import type {
  VisualizationType,
  VisualizationEncoding,
} from "@/lib/stores/types";
import { Button, Label, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dashframe/ui";
import { AddConnectionPanel } from "./AddConnectionPanel";

function extractVisualizationMetadata(
  spec: TopLevelSpec,
): {
  visualizationType: VisualizationType;
  encoding?: VisualizationEncoding;
} {
  const mark =
    "mark" in spec && typeof spec.mark === "string" ? spec.mark : "bar";
  const visualizationType = mark === "line" ? "line" : "bar";

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
  const addLocal = useDataSourcesStore((s) => s.addLocal);
  const getLocal = useDataSourcesStore((s) => s.getLocal);
  const addDataTable = useDataSourcesStore((s) => s.addDataTable);
  const setNotion = useDataSourcesStore((s) => s.setNotion);
  const getNotion = useDataSourcesStore((s) => s.getNotion);
  const persistedNotionConnection = useDataSourcesStore((s) => s.getNotion());
  const createDataFrameFromCSV = useDataFramesStore((s) => s.createFromCSV);
  const createDataFrameFromInsight = useDataFramesStore(
    (s) => s.createFromInsight,
  );
  const createVisualization = useVisualizationsStore((s) => s.create);

  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    setNotionApiKey("");
  }, []);

  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();
  const getDatabaseSchemaMutation = trpc.notion.getDatabaseSchema.useMutation();
  const queryDatabaseMutation = trpc.notion.queryDatabase.useMutation();

  const processCSVData = useCallback(
    (
      csvData: string[],
      fileName: string,
      fileSize: number,
    ) => {
      // Get or create local data source
      const localSource = getLocal();
      const dataSourceId = localSource ? localSource.id : addLocal("Local Files");

      // Generate DataTable ID upfront
      const dataTableId = crypto.randomUUID();

      // Convert CSV to DataFrame with fields
      const { dataFrame, fields, sourceSchema } = csvToDataFrameWithFields(
        csvData,
        dataTableId,
      );

      // Store DataFrame
      const dataFrameId = createDataFrameFromCSV(
        dataSourceId,
        `${fileName} Data`,
        dataFrame,
      );

      // Add DataTable with fields and sourceSchema
      addDataTable(
        dataSourceId,
        fileName.replace(/\.csv$/i, ""),
        fileName,
        {
          sourceSchema,
          fields,
          dataFrameId,
        },
      );

      // Build default visualization using fields
      const firstField = fields.find(f => f.columnName)?.name ?? null;
      const numberField = fields.find(f => f.type === "number" && f.columnName)?.name ?? null;

      const defaultSpec = buildVegaLiteSpec(dataFrame, {
        x: firstField,
        y: numberField ?? fields.find(f => f.columnName && f.name !== firstField)?.name ?? null,
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
    [getLocal, addLocal, addDataTable, createDataFrameFromCSV, createVisualization],
  );

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

          if (!result.data.length || !result.data[0]) {
            setError("CSV did not contain any data.");
            return;
          }

          processCSVData(result.data, file.name, file.size);
        },
      });
    },
    [processCSVData],
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
          err instanceof Error ? err.message : "Failed to fetch database schema",
        );
        setDatabaseSchema([]);
        setSelectedPropertyIds([]);
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [notionApiKey, getDatabaseSchemaMutation],
  );

  const handleToggleProperty = useCallback((propertyId: string) => {
    setSelectedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    );
  }, []);

  const processNotionData = useCallback(
    (
      dataFrame: DataFrame,
      notionSourceId: string,
      dataTableId: string,
      fields: Field[],
    ) => {
      const dataFrameId = createDataFrameFromCSV(
        notionSourceId,
        "Notion Data",
        dataFrame,
      );

      // Build default visualization using fields
      const firstField = fields.find(f => f.columnName)?.name ?? null;
      const numberField = fields.find(f => f.type === "number" && f.columnName)?.name ?? null;

      const defaultSpec = buildVegaLiteSpec(dataFrame, {
        x: firstField,
        y: numberField ?? fields.find(f => f.columnName && f.name !== firstField)?.name ?? null,
      });

      if (defaultSpec) {
        const { visualizationType, encoding } =
          extractVisualizationMetadata(defaultSpec);
        const { data, ...specWithoutData } = defaultSpec;

        createVisualization(
          {
            dataFrameId,
          },
          "Notion Chart",
          specWithoutData,
          visualizationType,
          encoding,
        );
      }

      return dataFrameId;
    },
    [createDataFrameFromCSV, createVisualization],
  );

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
      // Generate fields from schema
      const dataTableId = crypto.randomUUID();
      const { generateFieldsFromNotionSchema } = await import("@dashframe/notion");
      const { fields, sourceSchema } = generateFieldsFromNotionSchema(databaseSchema, dataTableId);

      // Fetch data from Notion
      const dataFrame = await queryDatabaseMutation.mutateAsync({
        apiKey: notionApiKey,
        databaseId: selectedDatabaseId,
        selectedPropertyIds,
      });

      if (!dataFrame.fieldIds?.length) {
        setError("No data found in the selected database");
        return;
      }

      // Process and store data
      const dataFrameId = processNotionData(dataFrame, notionSource.id, dataTableId, fields);

      // Find the selected database name
      const dbName = notionDatabases.find(db => db.id === selectedDatabaseId)?.title || "Notion Database";

      // Add DataTable with fields and sourceSchema
      addDataTable(
        notionSource.id,
        dbName,
        selectedDatabaseId,
        {
          sourceSchema,
          fields,
          dataFrameId,
        },
      );
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
    databaseSchema,
    notionDatabases,
    getNotion,
    addDataTable,
    queryDatabaseMutation,
    processNotionData,
  ]);

  const notionChildren = (
    <>
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
                <span className="text-xs text-muted-foreground">{prop.type}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {selectedDatabaseId && selectedPropertyIds.length > 0 && (
        <Button
          onClick={handleImportNotion}
          disabled={isImporting}
          className="w-full"
        >
          {isImporting ? "Importing..." : "Import Data"}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <AddConnectionPanel
        error={error}
        onCsvSelect={handleFileUpload}
        csvTitle="Upload CSV"
        csvDescription="Choose a CSV file with headers in the first row."
        csvHelperText="Supports .csv files up to 5MB"
        notion={{
          apiKey: notionApiKey,
          showApiKey,
          onApiKeyChange: setNotionApiKey,
          onToggleShowApiKey: () => setShowApiKey((prev) => !prev),
          onConnectNotion: handleConnectNotion,
          connectButtonLabel: isLoadingDatabases
            ? "Connecting..."
            : "Connect",
          connectDisabled: !notionApiKey || isLoadingDatabases,
          notionChildren,
        }}
      />
    </div>
  );
}
