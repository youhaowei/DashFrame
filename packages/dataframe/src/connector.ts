/**
 * Connector Pattern - Base classes for data source connectors
 *
 * This module provides abstract base classes for building data source connectors.
 * Connectors are stateless "strategy" objects that define configuration and methods
 * for parsing files or connecting to remote APIs.
 *
 * @example
 * ```typescript
 * // Create a file source connector
 * class CSVConnector extends FileSourceConnector {
 *   readonly id = 'csv';
 *   readonly name = 'CSV File';
 *   // ...
 * }
 *
 * // Create a remote API connector
 * class NotionConnector extends RemoteApiConnector {
 *   readonly id = 'notion';
 *   readonly name = 'Notion';
 *   // ...
 * }
 * ```
 */

import type { DataFrame, Field, SourceSchema, UUID } from "./index";

// ============================================================================
// Source Types
// ============================================================================

/**
 * Discriminated union for connector source types.
 * - 'file': Local file upload (CSV, Excel, etc.)
 * - 'remote-api': Remote API connection (Notion, Airtable, etc.)
 */
export type SourceType = "file" | "remote-api";

// ============================================================================
// Form Field Types
// ============================================================================

/**
 * Form field definition for dynamic connector configuration forms.
 * Used by the generic hook to render appropriate UI components.
 *
 * Note: 'file' type is NOT included - file inputs are handled separately
 * by the FileSourceConnector's `accept` and `helperText` properties.
 */
export interface FormField {
  name: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** Options for select type fields */
  options?: { value: string; label: string }[];
}

/**
 * Validation result with per-field errors.
 * Returned by connector's validate() method.
 */
export interface ValidationResult {
  valid: boolean;
  /** Per-field error messages: { fieldName: errorMessage } */
  errors?: Record<string, string>;
}

// ============================================================================
// Base Connector Class
// ============================================================================

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
   * Sanitized with DOMPurify at render time - safe for custom connectors.
   */
  abstract readonly icon: string;

  /**
   * Get form fields to render for this connector.
   * Return empty array if no configuration is needed.
   */
  abstract getFormFields(): FormField[];

  /**
   * Validate form data before executing an action.
   * Returns per-field errors for better UX.
   *
   * @param formData - Form values keyed by field name
   * @returns Validation result with optional per-field errors
   */
  abstract validate(formData: Record<string, unknown>): ValidationResult;
}

// ============================================================================
// File Source Connector
// ============================================================================

/**
 * Result from parsing a file.
 */
export interface FileParseResult {
  dataFrame: DataFrame;
  fields: Field[];
  sourceSchema: SourceSchema;
  rowCount: number;
  columnCount: number;
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
   * @throws Error on parse failure (caught by hook, shown in UI)
   */
  abstract parse(
    file: File,
    tableId: UUID,
    formData?: Record<string, unknown>,
  ): Promise<FileParseResult>;
}

// ============================================================================
// Remote API Connector
// ============================================================================

/**
 * A remote database/table that can be queried.
 */
export interface RemoteDatabase {
  id: string;
  name: string;
}

/**
 * Query options for pagination and filtering (future-proofing).
 */
export interface QueryOptions {
  pagination?: { offset: number; limit: number };
  // Future: Add filters, sorting, etc.
}

/**
 * Result from querying a remote database.
 */
export interface QueryResult {
  dataFrame: DataFrame;
  fields: Field[];
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
   *
   * @param formData - Configuration including API keys, etc.
   * @throws Error on connection failure (caught by hook, shown in UI)
   */
  abstract connect(
    formData: Record<string, unknown>,
  ): Promise<RemoteDatabase[]>;

  /**
   * Query a specific database.
   *
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
  ): Promise<QueryResult>;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union type for any connector.
 * Use for generic functions that work with both file and remote connectors.
 */
export type AnyConnector = FileSourceConnector | RemoteApiConnector;
