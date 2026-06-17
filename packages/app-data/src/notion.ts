import type { UUID } from "@dashframe/types";
import { useMutation } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";

/**
 * A Notion database as listed by the server's `listNotionDatabases` route.
 * `title` matches the shape the Notion data-source controls render and add by.
 */
export interface NotionDatabaseRef {
  id: string;
  title: string;
}

/**
 * Serializable result of a server-side Notion query: the raw Arrow IPC buffer
 * (base64) plus field ids and field definitions. The renderer materializes the
 * browser DataFrame from this — no plaintext and no live DataFrame crosses IPC.
 */
export interface NotionQueryResult {
  arrowBuffer: string;
  fieldIds: string[];
  fields: unknown[];
}

/**
 * Notion data-plane mutations, resolved SERVER-SIDE via the bound resolver.
 *
 * The credential never enters the renderer: both routes take a `dataSourceId`,
 * read the stored SecretRef from the row server-side, mint a one-secret bound
 * resolver, and call the connector. The renderer only ever holds the returned
 * data (database list, or Arrow buffer + field ids).
 */
export function useNotionMutations() {
  const listMutation = useMutation(api.listNotionDatabases);
  const queryMutation = useMutation(api.queryNotionDatabase);

  return useMemo(
    () => ({
      /** List the Notion databases accessible with the source's stored key. */
      listDatabases: async (
        dataSourceId: UUID,
      ): Promise<NotionDatabaseRef[]> => {
        return (await listMutation.mutateAsync({
          dataSourceId,
        })) as NotionDatabaseRef[];
      },
      /** Fetch a database's rows as a serializable Arrow result. */
      queryDatabase: async (
        dataSourceId: UUID,
        databaseId: string,
        tableId: UUID,
      ): Promise<NotionQueryResult> => {
        return (await queryMutation.mutateAsync({
          dataSourceId,
          databaseId,
          tableId,
        })) as NotionQueryResult;
      },
    }),
    [listMutation, queryMutation],
  );
}

/** Imperative variant of {@link useNotionMutations}'s listDatabases. */
export async function listNotionDatabases(
  dataSourceId: UUID,
): Promise<NotionDatabaseRef[]> {
  return (await getWyStackClient().mutate(api.listNotionDatabases, {
    dataSourceId,
  })) as NotionDatabaseRef[];
}
