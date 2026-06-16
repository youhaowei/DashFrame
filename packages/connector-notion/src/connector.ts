/**
 * Notion Connector — Remote API connector for Notion databases.
 *
 * Two exports:
 *
 * 1. `NotionConnector` — the AUTH-BOUND execution object.
 *    Auth-blind data plane: constructed with a SecretResolver pre-bound to
 *    exactly one secret ref. Data methods (`connect`, `query`) take data args
 *    only — no credential is ever passed at call time.
 *
 * 2. `NotionConnectorKind` — the REGISTRY-STORABLE descriptor.
 *    Has connector metadata (id, name, icon, getFormFields, validate) and a
 *    `createConnector(auth)` factory. Register THIS in the connector registry,
 *    not `NotionConnector` directly.
 *
 * Construction seam (data plane):
 *   const auth: SecretResolver = (use) => vault.withSecret(ref, use);
 *   const connector = new NotionConnector(auth); // or createNotionConnector(auth)
 *   await connector.query(databaseId, tableId); // no credential arg
 *
 * NOTE: Notion API has CORS restrictions. Methods like connect() and query()
 * need to be called through a server-side proxy (e.g., tRPC router, Next.js
 * API route). The web app is responsible for setting up this proxy layer.
 */

import {
  DataFrame,
  RemoteApiConnector,
  RemoteConnectorKind,
  type ConnectorQueryResult,
  type FormField,
  type QueryOptions,
  type RemoteDatabase,
  type SecretResolver,
  type UUID,
  type ValidationResult,
} from "@dashframe/engine-browser";
import { getDatabaseSchema, listDatabases, queryDatabase } from "./client";
import { convertNotionToDataFrame } from "./converter";
import { generateFieldsFromNotionSchema } from "./schema";

// Notion SVG icon (shared between descriptor and connector)
const NOTION_ICON = `<svg preserveAspectRatio="xMidYMid" viewBox="0 0 256 268"><path fill="#FFF" d="M16.092 11.538 164.09.608c18.179-1.56 22.85-.508 34.28 7.801l47.243 33.282C253.406 47.414 256 48.975 256 55.207v182.527c0 11.439-4.155 18.205-18.696 19.24L65.44 267.378c-10.913.517-16.11-1.043-21.825-8.327L8.826 213.814C2.586 205.487 0 199.254 0 191.97V29.726c0-9.352 4.155-17.153 16.092-18.188Z"/><path d="M164.09.608 16.092 11.538C4.155 12.573 0 20.374 0 29.726v162.245c0 7.284 2.585 13.516 8.826 21.843l34.789 45.237c5.715 7.284 10.912 8.844 21.825 8.327l171.864-10.404c14.532-1.035 18.696-7.801 18.696-19.24V55.207c0-5.911-2.336-7.614-9.21-12.66l-1.185-.856L198.37 8.409C186.94.1 182.27-.952 164.09.608ZM69.327 52.22c-14.033.945-17.216 1.159-25.186-5.323L23.876 30.778c-2.06-2.086-1.026-4.69 4.163-5.207l142.274-10.395c11.947-1.043 18.17 3.12 22.842 6.758l24.401 17.68c1.043.525 3.638 3.637.517 3.637L71.146 52.095l-1.819.125Zm-16.36 183.954V81.222c0-6.767 2.077-9.887 8.3-10.413L230.02 60.93c5.724-.517 8.31 3.12 8.31 9.879v153.917c0 6.767-1.044 12.49-10.387 13.008l-161.487 9.361c-9.343.517-13.489-2.594-13.489-10.921ZM212.377 89.53c1.034 4.681 0 9.362-4.681 9.897l-7.783 1.542v114.404c-6.758 3.637-12.981 5.715-18.18 5.715-8.308 0-10.386-2.604-16.609-10.396l-50.898-80.079v77.476l16.1 3.646s0 9.362-12.989 9.362l-35.814 2.077c-1.043-2.086 0-7.284 3.63-8.318l9.351-2.595V109.823l-12.98-1.052c-1.044-4.68 1.55-11.439 8.826-11.965l38.426-2.585 52.958 81.113v-71.76l-13.498-1.552c-1.043-5.733 3.111-9.896 8.3-10.404l35.84-2.087Z"/></svg>`;

// ============================================================================
// NotionConnector — auth-bound execution object
// ============================================================================

/**
 * Auth-bound Notion connector.
 *
 * Constructed with a {@link SecretResolver} pre-bound to exactly one secret.
 * Data methods (`connect`, `query`) carry NO credential — auth is resolved
 * internally via `this.auth`. The pipeline that calls these methods has no
 * vault, ref, or plaintext in scope.
 *
 * Obtain via `createNotionConnector(auth)` (factory function) or via
 * `notionConnectorKind.createConnector(auth)` (registry descriptor).
 */
export class NotionConnector extends RemoteApiConnector {
  readonly id = "notion";
  readonly name = "Notion";
  readonly description = "Connect to your Notion workspace.";
  readonly icon = NOTION_ICON;

  constructor(auth: SecretResolver) {
    super(auth);
  }

  getFormFields(): FormField[] {
    // No credential fields — auth is injected at construction.
    // The control-plane add-connection flow captures and stores the credential;
    // the form fields for that flow live in the control-plane layer.
    return [];
  }

  validate(_formData: Record<string, unknown>): ValidationResult {
    // Credential validation happens at vault-store time (control-plane layer).
    return { valid: true };
  }

  /**
   * Connect to Notion and list accessible databases.
   *
   * Auth-blind: resolves the API key via `this.auth` internally.
   * NOTE: Must be called through a server-side proxy due to CORS.
   */
  async connect(): Promise<RemoteDatabase[]> {
    const databases = await this.auth(async (apiKey) => {
      return listDatabases(apiKey);
    });

    return databases.map((db) => ({
      id: db.id,
      name: db.title,
    }));
  }

  /**
   * Query a Notion database and return a DataFrame.
   *
   * Auth-blind: resolves the API key via `this.auth` internally.
   * NOTE: Must be called through a server-side proxy due to CORS.
   *
   * @param databaseId - Notion database ID to query
   * @param tableId - UUID for the resulting DataTable
   * @param options - Optional pagination options
   */
  async query(
    databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult> {
    return this.auth(async (apiKey) => {
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
    });
  }
}

// ============================================================================
// NotionConnectorKind — registry-storable descriptor
// ============================================================================

/**
 * Registry-storable descriptor for the Notion connector kind.
 *
 * Carries metadata (id, name, icon, getFormFields, validate) and a factory
 * method (`createConnector`). Register this in the connector registry.
 *
 * The `getFormFields()` on this descriptor returns the credential capture
 * fields used during the initial add-connection flow (before the credential
 * is stored in the vault). The auth-bound `NotionConnector` returned by
 * `createConnector()` has no credential form fields.
 */
export class NotionConnectorKind extends RemoteConnectorKind {
  readonly id = "notion";
  readonly name = "Notion";
  readonly description = "Connect to your Notion workspace.";
  readonly icon = NOTION_ICON;

  /**
   * Form fields for initial credential capture (add-connection flow).
   *
   * The apiKey entered here is passed to the control-plane add-connection
   * flow, which stores it in the vault and returns a ref. The ref is then
   * used to mint a {@link SecretResolver} and construct a {@link NotionConnector}.
   */
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
   * Factory: mint an auth-bound {@link NotionConnector}.
   *
   * @param auth - One-ref-bound lease: `(use) => vault.withSecret(ref, use)`
   */
  createConnector(auth: SecretResolver): NotionConnector {
    return new NotionConnector(auth);
  }
}

/**
 * Singleton descriptor for the Notion connector kind.
 *
 * Register this in the connector registry (NOT a `NotionConnector` instance —
 * that requires auth). Use `notionConnectorKind.createConnector(auth)` to
 * obtain an auth-bound connector for data operations.
 */
export const notionConnectorKind = new NotionConnectorKind();
