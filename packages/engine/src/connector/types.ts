import type { Field, SourceSchema } from "@dashframe/core";
import type { DataFrame } from "../interfaces/dataframe";

/**
 * Discriminated union for connector source types.
 * - 'file': Local file upload (CSV, Excel, etc.)
 * - 'remote-api': Remote API connection (Notion, Airtable, etc.)
 */
export type SourceType = "file" | "remote-api";

/**
 * Form field definition for dynamic connector configuration forms.
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
 */
export interface ValidationResult {
  valid: boolean;
  /** Per-field error messages: { fieldName: errorMessage } */
  errors?: Record<string, string>;
}

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
 * A remote database/table that can be queried.
 */
export interface RemoteDatabase {
  id: string;
  name: string;
}

/**
 * Query options for pagination and filtering.
 */
export interface QueryOptions {
  pagination?: { offset: number; limit: number };
  // Future: Add filters, sorting, etc.
}

/**
 * Result from querying a remote database.
 */
export interface ConnectorQueryResult {
  dataFrame: DataFrame;
  fields: Field[];
}
