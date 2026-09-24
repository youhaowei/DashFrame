import type {
  Field,
  GrainScope,
  MeasureContract,
  SourceSchema,
  UUID,
} from "@dashframe/types";

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
  /** Arrow IPC bytes handed to the server-owned local connector onboarding path. */
  arrowBuffer: Uint8Array;
  primaryKey?: string | string[];
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
  /** Server-owned cancellation for remote I/O. */
  signal?: AbortSignal;
  /** Server-owned preflight ceiling for connectors that can measure remotely. */
  maxBytes?: number;
  /** Reject a result above this row count instead of returning a partial prefix. */
  maxRows?: number;
  /** Optional provider response budget, enforced by supporting connectors. */
  maxResponseBytes?: number;
  // Future: Add filters, sorting, etc.
}

/** Provider-neutral shape persisted for a table materialized from a definition. */
export interface TableDefinition {
  dimensions: string[];
  metrics: string[];
  dateRange:
    | { kind: "relative"; months: number }
    | { kind: "absolute"; start: string; end: string };
  grain: "day" | "week" | "month";
  filters?: Array<
    | {
        kind: "dimension";
        field: string;
        operator: "exact" | "inList";
        values: string[];
      }
    | {
        kind: "metric";
        field: string;
        operator: "greaterThan";
        value: number;
      }
  >;
}

/** How a materialized table can be reproduced. */
export type TableOrigin =
  | { kind: "resource" }
  | {
      kind: "definition";
      version: 1;
      presetId?: string;
      definition: TableDefinition;
    };

export interface ConnectorFieldMetadata {
  category: string;
  apiName: string;
  uiName: string;
  description: string;
  type: string;
  scope: GrainScope;
  contract?: MeasureContract;
  /** Recipe for rebuilding this ratio metric from summed component metrics; see RatioExpression. */
  ratioExpression?: RatioExpression;
}

// oxlint-disable-next-line sonarjs/redundant-type-aliases -- names the provider metric-reference role in this public recipe contract
export type MetricRef = string;

/**
 * Recipe for a ratio of sums. A compound numerator is evaluated per row only
 * when `rowwise` is true, then summed before division by the denominator sum.
 */
export interface RatioExpression {
  numerator:
    | MetricRef
    | {
        op: "add" | "sub" | "mul";
        left: MetricRef;
        right: MetricRef;
      };
  denominator: MetricRef;
  rowwise?: true;
}

export type DefinitionCompatibility =
  | { ok: true }
  | {
      ok: false;
      incompatible: Array<{ field: string; reason: string }>;
    };

export interface DefinitionQueryOptions extends QueryOptions {
  tableId: UUID;
}

/**
 * Result from querying a remote database.
 *
 * Serializable by design: `query()` runs server-side (remote APIs have CORS
 * restrictions and credentials must resolve server-side), so the result must
 * cross the IPC boundary as plain JSON. It carries the raw Arrow IPC buffer
 * (base64) plus field ids and field definitions. The host persists those bytes
 * as an immutable file-backed DataFrame after the result crosses the transport
 * boundary. Keeping this connector result plain makes it callable from Node.
 */
export interface ConnectorQueryResult {
  /** Arrow IPC buffer, base64-encoded for JSON transport. */
  arrowBuffer: string;
  /** Field ids, aligned with the Arrow schema columns. */
  fieldIds: string[];
  /** Field definitions for the resulting table. */
  fields: Field[];
  /** Number of rows in the materialized Arrow buffer. */
  rowCount: number;
}
