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

/**
 * Create a Notion API client for the given plaintext API key.
 * Callers are responsible for caching the instance when reuse is desired.
 * The key must not be stored as a Map key or in any scope that outlives
 * the enclosing `withSecret` callback window.
 */
export function createNotionClient(apiKey: string): Client {
  return new Client({ auth: apiKey });
}

/**
 * List all databases accessible with the given Notion client
 */
export async function listDatabases(client: Client): Promise<NotionDatabase[]> {
  const response: SearchResponse = await client.search({
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
  client: Client,
  databaseId: string,
): Promise<NotionProperty[]> {
  const response: GetDatabaseResponse = await client.databases.retrieve({
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
  client: Client,
  databaseId: string,
  options?: {
    pageSize?: number; // Limit number of rows fetched
  },
): Promise<QueryDatabaseResponse> {
  // Notion API pagination - fetch all results (or up to pageSize)
  let hasMore = true;
  let startCursor: string | undefined = undefined;
  const allResults: QueryDatabaseResponse["results"] = [];
  const maxRows = options?.pageSize || Infinity;

  while (hasMore && allResults.length < maxRows) {
    const response: QueryDatabaseResponse = await client.databases.query({
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
