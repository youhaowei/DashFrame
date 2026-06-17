import { Client } from "@notionhq/client";
import type {
  GetDatabaseResponse,
  QueryDatabaseResponse,
  SearchResponse,
} from "@notionhq/client/build/src/api-endpoints";

export type NotionDatabase = {
  id: string;
  title: string;
};

export type NotionProperty = {
  id: string;
  name: string;
  type: string;
};

// Per-process cache: one Client instance per API key.
// Avoids re-constructing (and re-validating) the client on every call.
// Single-user desktop scope: no TTL/eviction because the process lifetime is
// bounded. For a multi-tenant server, key by opaque SecretRef (not plaintext)
// and add eviction on DataSource deletion.
const clientCache = new Map<string, Client>();

function getClient(apiKey: string): Client {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new Client({ auth: apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}

/**
 * List all databases accessible with the given API key
 */
export async function listDatabases(apiKey: string): Promise<NotionDatabase[]> {
  const notion = getClient(apiKey);

  const response: SearchResponse = await notion.search({
    filter: {
      property: "object",
      value: "database",
    },
    sort: {
      direction: "descending",
      timestamp: "last_edited_time",
    },
  });

  return response.results
    .filter((result) => result.object === "database")
    .map((db) => {
      if (db.object !== "database") {
        throw new Error("Expected database object");
      }

      // Extract title from database properties
      const titleProp = "title" in db ? db.title : [];
      const first = titleProp[0];
      const title =
        first && first.type === "text" ? first.text.content : "Untitled";

      return {
        id: db.id,
        title,
      };
    });
}

/**
 * Get the schema (properties/columns) of a specific database
 */
export async function getDatabaseSchema(
  apiKey: string,
  databaseId: string,
): Promise<NotionProperty[]> {
  const notion = getClient(apiKey);

  const response: GetDatabaseResponse = await notion.databases.retrieve({
    database_id: databaseId,
  });

  // Convert properties object to array
  return Object.entries(response.properties).map(([name, property]) => ({
    id: property.id,
    name,
    type: property.type,
  }));
}

/**
 * Query database and return all pages with selected properties
 */
export async function queryDatabase(
  apiKey: string,
  databaseId: string,
  options?: {
    pageSize?: number; // Limit number of rows fetched
  },
): Promise<QueryDatabaseResponse> {
  const notion = getClient(apiKey);

  // Notion API pagination - fetch all results (or up to pageSize)
  let hasMore = true;
  let startCursor: string | undefined = undefined;
  const allResults: QueryDatabaseResponse["results"] = [];
  const maxRows = options?.pageSize || Infinity;

  while (hasMore && allResults.length < maxRows) {
    const response: QueryDatabaseResponse = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor,
      page_size: options?.pageSize
        ? Math.min(100, maxRows - allResults.length)
        : 100,
      // Note: Notion API doesn't support filtering properties in query,
      // we'll need to filter on the client side
    });

    allResults.push(...response.results);

    // Stop if we hit page size limit
    if (options?.pageSize && allResults.length >= options.pageSize) {
      hasMore = false;
    } else {
      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }
  }

  return {
    object: "list" as const,
    results: allResults.slice(0, options?.pageSize),
    has_more: false,
    next_cursor: null,
    type: "page_or_database" as const,
    page_or_database: {} as const,
  };
}
