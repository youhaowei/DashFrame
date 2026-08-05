import type { UseQueryResult } from "./repository-base";

export type ConnectorAuthKind = "none" | "credential";

export type ConnectorFormFieldType =
  | "text"
  | "password"
  | "select"
  | "number"
  | "checkbox"
  | "textarea";

/**
 * Structurally mirrors @dashframe/engine's `FormField` (packages/engine/src/connector/types.ts).
 * Duplicated intentionally, not imported: @dashframe/types is upstream of
 * @dashframe/engine (engine imports Field/SourceSchema from @dashframe/types),
 * so the reverse import would be circular.
 */
export interface ConnectorFormField {
  name: string;
  label: string;
  type: ConnectorFormFieldType;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
}

export interface ConnectorCatalogEntry {
  id: string;
  name: string;
  description: string;
  sourceType: "file" | "remote-api";
  icon: string;
  authKind: ConnectorAuthKind;
  formFields: ConnectorFormField[];
  /** File connectors only. */
  accept?: string;
  /** File connectors only. */
  maxSizeMB?: number;
  /** File connectors only. */
  helperText?: string;
}

export type UseConnectorCatalogResult = UseQueryResult<ConnectorCatalogEntry[]>;
