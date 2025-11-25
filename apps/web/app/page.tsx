"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrameWithFields } from "@dashframe/csv";
import { trpc } from "@/lib/trpc/Provider";
import type { NotionDatabase } from "@dashframe/notion";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@dashframe/convex";
import type { Id } from "@dashframe/convex/dataModel";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { Card, CardContent, BarChart3, Alert, AlertDescription } from "@dashframe/ui";
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";

/**
 * Home Page
 *
 * Embeds the visualization creation flow directly on the page.
 * Users can immediately upload CSV or connect Notion without any clicks.
 */
export default function HomePage() {
  const router = useRouter();

  // Notion UI state
  const [notionApiKey, setNotionApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [notionDatabases, setNotionDatabases] = useState<NotionDatabase[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth state
  const token = useAuthToken();
  const isAuthenticated = token !== null;

  // Convex mutations
  const createDataSource = useMutation(api.dataSources.create);
  const createDataTable = useMutation(api.dataTables.create);
  const createInsight = useMutation(api.insights.create);

  // Check for existing Notion source
  const dataSources = useQuery(api.dataSources.list) ?? [];
  const notionSource = dataSources.find((s) => s.type === "notion");

  // DataFrames store
  const createDataFrameFromCSV = useDataFramesStore((s) => s.createFromCSV);

  // tRPC for Notion API
  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();

  // Handle CSV upload
  const handleCSVUpload = useCallback(
    async (file: File) => {
      setError(null);

      // Guard: Don't proceed if not authenticated
      if (!isAuthenticated) {
        setError("Session not ready. Please wait a moment and try again.");
        return;
      }

      try {
        // Parse CSV file
        Papa.parse<Record<string, string>>(file, {
          header: true,
          skipEmptyLines: true,
          complete: async (results: ParseResult<Record<string, string>>) => {
            if (results.errors.length > 0) {
              const errorMsg = results.errors
                .map((e: ParseError) => e.message)
                .join(", ");
              setError(`CSV parsing errors: ${errorMsg}`);
              return;
            }

            if (!results.data || results.data.length === 0) {
              setError("CSV file is empty or has no data rows");
              return;
            }

            // Create or get "Local Files" data source
            let sourceId: Id<"dataSources">;
            const existingLocalSource = dataSources.find((s) => s.type === "local");

            if (existingLocalSource) {
              sourceId = existingLocalSource._id;
            } else {
              sourceId = await createDataSource({
                type: "local",
                name: "Local Files",
              });
            }

            // Convert CSV to DataFrame with fields
            const { dataFrame, fields } = csvToDataFrameWithFields(results.data);

            // Create data table in Convex
            const tableId = await createDataTable({
              dataSourceId: sourceId,
              name: file.name.replace(".csv", ""),
              table: file.name,
              sourceSchema: {
                fields: fields.map((f) => ({
                  name: f.name,
                  type: f.type,
                })),
              },
            });

            // Create insight
            const insightId = await createInsight({
              name: `${file.name.replace(".csv", "")} Insight`,
              baseTableId: tableId,
              selectedFieldIds: [],
            });

            // Store DataFrame client-side
            createDataFrameFromCSV(
              insightId as string,
              file.name.replace(".csv", ""),
              dataFrame
            );

            // Navigate to insight page
            router.push(`/insights/${insightId}`);
          },
          error: (error: Error) => {
            setError(`Failed to parse CSV: ${error.message}`);
          },
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to upload CSV"
        );
      }
    },
    [isAuthenticated, dataSources, createDataSource, createDataTable, createInsight, createDataFrameFromCSV, router]
  );

  // Handle Notion connection
  const handleConnectNotion = useCallback(async () => {
    if (!notionApiKey) return;

    setError(null);
    setIsLoadingDatabases(true);

    try {
      const databases = await listDatabasesMutation.mutateAsync({
        apiKey: notionApiKey,
      });

      if (!databases || databases.length === 0) {
        setError("No databases found in your Notion workspace");
        setIsLoadingDatabases(false);
        return;
      }

      setNotionDatabases(databases);

      // Create or update Notion data source
      if (!notionSource) {
        await createDataSource({
          type: "notion",
          name: "Notion",
          apiKey: notionApiKey,
        });
      }

      // For now, just show success - user will need to select database
      // In a full flow, you'd show a database selector next
      setError("Notion connected! Please select a database to continue.");
      setIsLoadingDatabases(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to Notion"
      );
      setIsLoadingDatabases(false);
    }
  }, [notionApiKey, notionSource, listDatabasesMutation, createDataSource]);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-12 max-w-3xl">
          <Card className="text-center mb-8">
            <CardContent className="p-8">
              {/* Icon */}
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>

              {/* Heading */}
              <h2 className="text-2xl font-bold mb-2">
                Welcome to DashFrame
              </h2>

              {/* Description */}
              <p className="text-muted-foreground text-base">
                Create beautiful visualizations from your data.
                Upload a CSV file or connect to Notion to get started.
              </p>
            </CardContent>
          </Card>

          {/* Error Alert */}
          {error && (
            <Alert variant={error.includes("connected") ? "default" : "destructive"} className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Add Connection Panel - First Step Embedded */}
          <AddConnectionPanel
            onCsvSelect={handleCSVUpload}
            csvTitle="Upload CSV File"
            csvDescription="Upload a CSV file with headers in the first row."
            csvHelperText="Supports .csv files up to 5MB"
            notion={{
              apiKey: notionApiKey,
              showApiKey,
              onApiKeyChange: setNotionApiKey,
              onToggleShowApiKey: () => setShowApiKey((prev) => !prev),
              onConnectNotion: handleConnectNotion,
              connectButtonLabel: isLoadingDatabases ? "Connecting..." : "Connect Notion",
              connectDisabled: !notionApiKey || isLoadingDatabases,
            }}
          />
        </div>
      </main>
    </div>
  );
}
