/**
 * Notion Connector - Remote API connector for Notion databases
 *
 * This connector handles Notion API connection and data fetching.
 * It's fully self-contained - all Notion logic stays in this package.
 *
 * NOTE: Notion API has CORS restrictions. Methods like connect() and query()
 * need to be called through a server-side proxy (e.g., tRPC router, Next.js API route).
 * The web app is responsible for setting up this proxy layer.
 */

import {
  RemoteApiConnector,
  DataFrame,
  type FormField,
  type RemoteDatabase,
  type ValidationResult,
  type QueryResult,
  type QueryOptions,
  type UUID,
} from "@dashframe/dataframe";
import { listDatabases, getDatabaseSchema, queryDatabase } from "./client";
import { convertNotionToDataFrame } from "./converter";
import { generateFieldsFromNotionSchema } from "./index";

/**
 * NotionConnector - Handles Notion workspace connection and database queries.
 *
 * @example
 * ```typescript
 * import { notionConnector } from '@dashframe/notion';
 *
 * // Get form fields for API key input
 * const fields = notionConnector.getFormFields();
 *
 * // Validate user input
 * const validation = notionConnector.validate({ apiKey: 'secret_...' });
 *
 * // Connect and list databases (via tRPC proxy)
 * const databases = await notionConnector.connect({ apiKey: 'secret_...' });
 *
 * // Query a specific database (via tRPC proxy)
 * const result = await notionConnector.query(databaseId, tableId, { apiKey: 'secret_...' });
 * ```
 */
export class NotionConnector extends RemoteApiConnector {
  readonly id = "notion";
  readonly name = "Notion";
  readonly description = "Connect to your Notion workspace.";
  readonly icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor"><path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"/></svg>`;

  getFormFields(): FormField[] {
    return [
      {
        name: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "secret_...",
        hint: "Stored locally in your browser.",
        required: true,
      },
    ];
  }

  validate(formData: Record<string, unknown>): ValidationResult {
    const apiKey = formData.apiKey as string | undefined;

    if (!apiKey) {
      return { valid: false, errors: { apiKey: "API key is required" } };
    }

    if (!apiKey.startsWith("secret_")) {
      return {
        valid: false,
        errors: { apiKey: 'API key should start with "secret_"' },
      };
    }

    return { valid: true };
  }

  /**
   * Connect to Notion and list accessible databases.
   *
   * NOTE: Must be called through a server-side proxy due to CORS.
   *
   * @param formData - Must contain `apiKey` string
   */
  async connect(formData: Record<string, unknown>): Promise<RemoteDatabase[]> {
    const apiKey = formData.apiKey as string;

    const databases = await listDatabases(apiKey);

    return databases.map((db) => ({
      id: db.id,
      name: db.title,
    }));
  }

  /**
   * Query a Notion database and return a DataFrame.
   *
   * NOTE: Must be called through a server-side proxy due to CORS.
   * The actual implementation fetches data server-side, but DataFrame creation
   * requires browser context (IndexedDB). The web app should handle this split:
   * 1. Call this method server-side to get raw data
   * 2. Create DataFrame client-side from the returned data
   *
   * @param databaseId - Notion database ID to query
   * @param tableId - UUID for the resulting DataTable
   * @param formData - Must contain `apiKey` string
   * @param options - Optional pagination options
   */
  async query(
    databaseId: string,
    tableId: UUID,
    formData: Record<string, unknown>,
    options?: QueryOptions,
  ): Promise<QueryResult> {
    const apiKey = formData.apiKey as string;

    // Step 1: Get database schema
    const schema = await getDatabaseSchema(apiKey, databaseId);

    // Step 2: Generate fields from schema
    const { fields } = generateFieldsFromNotionSchema(schema, tableId);

    // Step 3: Query the database
    const pageSize = options?.pagination?.limit;
    const response = await queryDatabase(apiKey, databaseId, {
      pageSize,
    });

    // Step 4: Convert to DataFrame format
    const conversionResult = convertNotionToDataFrame(response, fields);

    // Step 5: Create DataFrame from Arrow buffer
    // NOTE: This requires browser context (IndexedDB)
    // Decode base64 arrow buffer to Uint8Array
    const arrowBuffer = Uint8Array.from(
      atob(conversionResult.arrowBuffer),
      (c) => c.charCodeAt(0),
    );

    const dataFrame = await DataFrame.create(
      arrowBuffer,
      conversionResult.fieldIds,
      {
        storageType: "indexeddb",
        primaryKey: "_notionId",
      },
    );

    return {
      dataFrame,
      fields,
    };
  }
}

/**
 * Singleton instance of the Notion connector.
 * Use this in the web app's connector registry.
 */
export const notionConnector = new NotionConnector();
