import type { Field, SourceSchema } from "@dashframe/types";
import type { DataFrame } from "../interfaces/dataframe";

/**
 * Discriminated union for connector source types.
 * - 'file': Local file upload (CSV, Excel, etc.)
 * - 'remote-api': Remote API connection (Notion, Airtable, etc.)
 */
export type SourceType = "file" | "remote-api";

/**
 * Supported form field types for connector configuration.
 *
 * - text: Single-line text input
 * - password: Masked text input for secrets/API keys
 * - select: Dropdown selection from predefined options
 * - number: Numeric input with optional min/max/step
 * - checkbox: Boolean toggle
 * - textarea: Multi-line text input
 *
 * Note: 'file' type is NOT included - file inputs are handled separately
 * by the FileSourceConnector's `accept` and `helperText` properties.
 */
export type FormFieldType =
  | "text"
  | "password"
  | "select"
  | "number"
  | "checkbox"
  | "textarea";

/**
 * Form field definition for dynamic connector configuration forms.
 *
 * Use the appropriate field type for the data being collected:
 * - text/password for strings
 * - number for numeric values with optional constraints
 * - checkbox for boolean flags
 * - textarea for multi-line content
 * - select for predefined choices
 */
export interface FormField {
  /** Unique field identifier (used as form value key) */
  name: string;
  /** Human-readable label */
  label: string;
  /** Input type determining the rendered control */
  type: FormFieldType;
  /** Placeholder text shown in empty fields */
  placeholder?: string;
  /** Helper text shown below the field */
  hint?: string;
  /** Whether the field is required for form submission */
  required?: boolean;
  /** Options for select type fields */
  options?: { value: string; label: string }[];
  /** Minimum value (for number type) */
  min?: number;
  /** Maximum value (for number type) */
  max?: number;
  /** Step increment (for number type) */
  step?: number;
  /** Number of visible text rows (for textarea type) */
  rows?: number;
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
