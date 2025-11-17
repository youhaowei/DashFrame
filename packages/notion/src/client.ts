import { Client } from "@notionhq/client";
import type {
  QueryDatabaseResponse,
  GetDatabaseResponse,
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
 * List all databases accessible with the given API key
 */
export async function listDatabases(apiKey: string): Promise<NotionDatabase[]> {
  const notion = new Client({ auth: apiKey });

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
      const title =
        titleProp.length > 0 && titleProp[0].type === "text"
          ? titleProp[0].text.content
          : "Untitled";

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
  const notion = new Client({ auth: apiKey });

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
): Promise<QueryDatabaseResponse> {
  const notion = new Client({ auth: apiKey });

  // Notion API pagination - fetch all results
  let hasMore = true;
  let startCursor: string | undefined = undefined;
  const allResults: QueryDatabaseResponse["results"] = [];

  while (hasMore) {
    const response: QueryDatabaseResponse = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor,
      // Note: Notion API doesn't support filtering properties in query,
      // we'll need to filter on the client side
    });

    allResults.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }

  return {
    object: "list" as const,
    results: allResults,
    has_more: false,
    next_cursor: null,
    type: "page_or_database" as const,
    page_or_database: {} as const,
  };
}
