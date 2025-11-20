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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      dataFrame: ReturnType<typeof csvToDataFrame>,
      fileName: string,
      fileSize: number,
    ) => {
      const dataSourceId = crypto.randomUUID();

      const dataFrameId = createDataFrameFromCSV(
        dataSourceId,
        `${fileName} Data`,
        dataFrame,
      );

      addCSV(
        fileName.replace(/\.csv$/i, ""),
        fileName,
        fileSize,
        dataFrameId,
      );

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
      insightId: string,
    ) => {
      const dataFrameId = createDataFrameFromInsight(
        notionSourceId,
        insightId,
        "Notion Data",
        dataFrame,
      );

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
      const insightId = addInsight(
        notionSource.id,
        `${selectedDatabaseId} Insight`,
        selectedDatabaseId,
        selectedPropertyIds,
      );

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
