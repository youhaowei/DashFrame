import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc/Provider";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { NotionDatabase } from "@dashframe/notion";

export interface UseNotionConnectionReturn {
  apiKey: string;
  showApiKey: boolean;
  setApiKey: (key: string) => void;
  toggleShowApiKey: () => void;
  connect: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  databases: NotionDatabase[];
}

export function useNotionConnection(): UseNotionConnectionReturn {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setNotionDataSource = useDataSourcesStore((state) => state.setNotion);
  const dataSources = useDataSourcesStore((state) => state.getAll());
  const notionSource = dataSources.find((s) => s.type === "notion");

  const listDatabasesMutation = trpc.notion.listDatabases.useMutation();

  const toggleShowApiKey = useCallback(() => {
    setShowApiKey((prev) => !prev);
  }, []);

  const connect = useCallback(async () => {
    if (!apiKey) return;

    setError(null);
    setIsLoading(true);

    try {
      const dbs = await listDatabasesMutation.mutateAsync({
        apiKey: apiKey,
      });

      if (!dbs || dbs.length === 0) {
        setError("No databases found in your Notion workspace");
        setIsLoading(false);
        return;
      }

      setDatabases(dbs);

      // Create or update Notion data source (LOCAL ONLY)
      if (!notionSource) {
        setNotionDataSource(apiKey, "Notion");
      }

      // For now, just show success - user will need to select database
      setError("Notion connected! Please select a database to continue.");
      setIsLoading(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to Notion",
      );
      setIsLoading(false);
    }
  }, [apiKey, notionSource, listDatabasesMutation, setNotionDataSource]);

  return {
    apiKey,
    showApiKey,
    setApiKey,
    toggleShowApiKey,
    connect,
    isLoading,
    error,
    databases,
  };
}
