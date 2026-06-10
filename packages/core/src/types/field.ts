import type { ColumnType, TableColumn } from "./column";
import type { UUID } from "./uuid";

/**
 * Privacy sensitivity marker for a Field.
 *
 * Tri-state, fail-closed: `unclassified` (the default when absent) reads as
 * restricted — every privacy gate treats it exactly like `sensitive` until a
 * deliberate decision writes `cleared`.
 *
 * - `unclassified` — nobody has confidently decided; restricted by default.
 * - `sensitive` — confirmed sensitive; restricted.
 * - `cleared` — confirmed safe; unrestricted.
 */
export type FieldSensitivity = "unclassified" | "sensitive" | "cleared";

/**
 * Who wrote the current sensitivity value.
 *
 * `classifier` means the user confirmed a classifier suggestion — in
 * suggest-mode the classifier never writes the marker on its own.
 */
export type FieldSensitivitySource = "user" | "classifier";

/**
 * Field - User-facing column with lineage tracking.
 *
 * Fields are derived from TableColumns but have:
 * - User-editable names
 * - Normalized types
 * - Lineage back to source table
 */
export type Field = {
  id: UUID;
  /** User-facing name (can be renamed) */
  name: string;
  /** Which DataTable owns this field (lineage) */
  tableId: UUID;
  /** Which TableColumn this maps to (undefined for computed fields) */
  columnName?: string;
  /** Normalized type: "string" | "number" | "date" | "boolean" */
  type: ColumnType;
  isIdentifier?: boolean;
  isReference?: boolean;
  /**
   * Privacy axis — single source of truth read by every privacy gate
   * (cache-write, artifact-DB, egress) and by engine placement.
   * Absent means `unclassified`, which is restricted (fail-closed).
   * Distinct from the semantic axis (`isIdentifier`/`isReference`).
   */
  sensitivity?: FieldSensitivity;
  /** Why the current sensitivity value was set — keeps marking legible */
  sensitivityReason?: string;
  /** Who set the current sensitivity value */
  sensitivitySource?: FieldSensitivitySource;
};

/**
 * Resolve a field's effective sensitivity. Absent reads as `unclassified` —
 * the column default IS the fail-closed invariant.
 */
export function getFieldSensitivity(
  field: Pick<Field, "sensitivity">,
): FieldSensitivity {
  return field.sensitivity ?? "unclassified";
}

/**
 * Whether privacy gates must restrict this field.
 *
 * The single read point for all enforcement placements: only an explicit
 * `cleared` unlocks a field; `sensitive` and `unclassified` are both
 * restricted.
 */
export function isFieldRestricted(field: Pick<Field, "sensitivity">): boolean {
  return getFieldSensitivity(field) !== "cleared";
}

/**
 * Source schema wrapper - tracks schema version and sync time.
 */
export type SourceSchema = {
  columns: TableColumn[];
  version: number;
  lastSyncedAt: number;
};
