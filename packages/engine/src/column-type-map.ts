import type { ColumnType } from "@dashframe/types";

/**
 * Exhaustive map keyed by every normalized DashFrame column type.
 *
 * Runtime packages use this contract for their Arrow and DuckDB adapters so a
 * new `ColumnType` cannot be added without TypeScript identifying every adapter
 * that needs a mapping decision.
 */
export type ColumnTypeMap<Value> = { [Type in ColumnType]: Value };

/** Preserve each entry's inferred value type while enforcing exhaustiveness. */
export function defineColumnTypeMap<const Map extends ColumnTypeMap<unknown>>(
  map: Map,
): Map {
  return map;
}

/** Infer a normalized column type from an already-typed primitive value. */
export function inferPrimitiveColumnType(
  value: boolean | number | string | null,
  inferString: (value: string) => ColumnType = () => "string",
): ColumnType {
  if (value === null) return "unknown";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return inferString(value);
}
