import type { UUID } from "@dashframe/types";
import type {
  ConnectorQueryResult,
  FileParseResult,
  FormField,
  QueryOptions,
  RemoteDatabase,
  SourceType,
  ValidationResult,
} from "./types";

/**
 * Base connector class - stateless, pure config + methods.
 *
 * Connectors are "strategy" objects that define:
 * - Static configuration (id, name, description, icon)
 * - Form field definitions for dynamic UI
 * - Validation logic for form data
 *
 * State management is handled by React hooks, not the connector.
 */
export abstract class BaseConnector {
  /** Unique identifier for this connector */
  abstract readonly id: string;

  /** Display name shown in UI */
  abstract readonly name: string;

  /** Description shown below the name */
  abstract readonly description: string;

  /** Source type discriminant */
  abstract readonly sourceType: SourceType;

  /**
   * SVG string for the connector icon.
   * Sanitized with DOMPurify at render time.
   */
  abstract readonly icon: string;

  /**
   * Get form fields to render for this connector.
   * Return empty array if no configuration is needed.
   */
  abstract getFormFields(): FormField[];

  /**
   * Validate form data before executing an action.
   * @param formData - Form values keyed by field name
   * @returns Validation result with optional per-field errors
   */
  abstract validate(formData: Record<string, unknown>): ValidationResult;
}

/**
 * File source connector for local file uploads (CSV, Excel, etc.).
 *
 * NOTE: The `parse` method uses the browser's File API.
 * Only use in client components with "use client" directive.
 */
export abstract class FileSourceConnector extends BaseConnector {
  readonly sourceType = "file" as const;

  /** File input accept attribute (e.g., '.csv,text/csv') */
  abstract readonly accept: string;

  /** Maximum file size in MB (enforced in UI) */
  abstract readonly maxSizeMB?: number;

  /** Helper text shown below the file input */
  abstract readonly helperText?: string;

  /**
   * Parse an uploaded file into a DataFrame.
   *
   * NOTE: Browser-only - uses File API.
   *
   * @param file - The uploaded File object
   * @param tableId - UUID to assign to the resulting table
   * @param formData - Optional form configuration data
   * @throws Error on parse failure
   */
  abstract parse(
    file: File,
    tableId: UUID,
    formData?: Record<string, unknown>,
  ): Promise<FileParseResult>;
}

/**
 * Remote API connector for external services (Notion, Airtable, etc.).
 *
 * Two-phase workflow:
 * 1. connect() - Authenticate and list available databases
 * 2. query() - Fetch data from a specific database
 */
export abstract class RemoteApiConnector extends BaseConnector {
  readonly sourceType = "remote-api" as const;

  /**
   * Connect and list available databases.
   * @param formData - Configuration including API keys, etc.
   * @throws Error on connection failure
   */
  abstract connect(
    formData: Record<string, unknown>,
  ): Promise<RemoteDatabase[]>;

  /**
   * Query a specific database.
   * @param databaseId - ID of the database to query
   * @param tableId - UUID to assign to the resulting table
   * @param formData - Configuration including API keys, etc.
   * @param options - Optional pagination/filter options
   */
  abstract query(
    databaseId: string,
    tableId: UUID,
    formData: Record<string, unknown>,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult>;
}

/**
 * Union type for any connector.
 */
export type AnyConnector = FileSourceConnector | RemoteApiConnector;

/**
 * Type guard to check if a connector is a file source connector.
 *
 * @example
 * ```typescript
 * if (isFileConnector(connector)) {
 *   // TypeScript knows connector is FileSourceConnector
 *   connector.parse(file, tableId);
 * }
 * ```
 */
export function isFileConnector(
  connector: AnyConnector,
): connector is FileSourceConnector {
  return connector.sourceType === "file";
}

/**
 * Type guard to check if a connector is a remote API connector.
 *
 * @example
 * ```typescript
 * if (isRemoteApiConnector(connector)) {
 *   // TypeScript knows connector is RemoteApiConnector
 *   await connector.connect(formData);
 * }
 * ```
 */
export function isRemoteApiConnector(
  connector: AnyConnector,
): connector is RemoteApiConnector {
  return connector.sourceType === "remote-api";
}
