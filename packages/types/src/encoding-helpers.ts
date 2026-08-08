/**
 * Encoding Helpers for Visualization Channel Mappings
 *
 * This module provides strict types and parsing helpers for visualization encodings.
 * Encodings use prefixed string IDs as the canonical format:
 * - `field:<uuid>` for dimension fields
 * - `metric:<uuid>` for metric aggregations
 *
 * This approach ensures encodings remain stable when users rename metrics or fields,
 * since the underlying IDs don't change.
 */

import type { UUID } from "./uuid";

// ============================================================================
// Strict Encoding Types (compile-time validation)
// ============================================================================

/**
 * Encoding value for a dimension field.
 * Format: `field:<uuid>`
 */
export type FieldEncodingValue = `field:${UUID}`;

/**
 * Encoding value for a metric aggregation.
 * Format: `metric:<uuid>`
 */
export type MetricEncodingValue = `metric:${UUID}`;

/**
 * Valid encoding value - either a field or metric reference.
 * TypeScript will reject invalid strings like `"sum(amount)"` at compile time.
 */
export type EncodingValue = FieldEncodingValue | MetricEncodingValue;

// ============================================================================
// Encoding Value Parsing
// ============================================================================

/**
 * Type of encoding reference.
 */
export type EncodingType = "field" | "metric";

/**
 * Parsed encoding with type and ID extracted.
 */
export interface ParsedEncoding {
  type: EncodingType;
  id: UUID;
}

/**
 * Parse an encoding string into its type and ID components.
 * Returns undefined for invalid formats (no legacy support).
 *
 * @param value - Encoding string (e.g., "field:abc-123" or "metric:xyz-456")
 * @returns Parsed encoding or undefined if format is invalid
 *
 * @example
 * ```typescript
 * parseEncoding("field:abc-123")
 * // Returns: { type: "field", id: "abc-123" }
 *
 * parseEncoding("metric:xyz-456")
 * // Returns: { type: "metric", id: "xyz-456" }
 *
 * parseEncoding("sum(revenue)")  // Legacy format
 * // Returns: undefined
 * ```
 */
export function parseEncoding(
  value: string | undefined,
): ParsedEncoding | undefined {
  if (!value) return undefined;

  if (value.startsWith("field:")) {
    return { type: "field", id: value.slice(6) as UUID };
  }
  if (value.startsWith("metric:")) {
    return { type: "metric", id: value.slice(7) as UUID };
  }

  // Invalid format - no legacy support
  return undefined;
}

// ============================================================================
// Encoding Value Constructors
// ============================================================================

/**
 * Create a field encoding string from a field ID.
 *
 * @param id - Field UUID
 * @returns Field encoding value (e.g., "field:abc-123")
 */
export function fieldEncoding(id: UUID): FieldEncodingValue {
  return `field:${id}`;
}

/**
 * Create a metric encoding string from a metric ID.
 *
 * @param id - Metric UUID
 * @returns Metric encoding value (e.g., "metric:abc-123")
 */
export function metricEncoding(id: UUID): MetricEncodingValue {
  return `metric:${id}`;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for field encoding values.
 *
 * @param value - String to check
 * @returns True if value is a valid field encoding
 */
export function isFieldEncoding(
  value: string | undefined,
): value is FieldEncodingValue {
  return value?.startsWith("field:") ?? false;
}

/**
 * Type guard for metric encoding values.
 *
 * @param value - String to check
 * @returns True if value is a valid metric encoding
 */
export function isMetricEncoding(
  value: string | undefined,
): value is MetricEncodingValue {
  return value?.startsWith("metric:") ?? false;
}

/**
 * Type guard for valid encoding values (field or metric).
 *
 * @param value - String to check
 * @returns True if value is a valid encoding (either field or metric)
 */
export function isValidEncoding(
  value: string | undefined,
): value is EncodingValue {
  return isFieldEncoding(value) || isMetricEncoding(value);
}

// ============================================================================
// Write-time Validation
// ============================================================================

/**
 * The encoding channels whose values are channel references. The other keys of
 * `VisualizationEncoding` (`xType`, `yType`, `xTransform`, `yTransform`) carry
 * their own shapes and are validated separately below.
 */
export const ENCODING_VALUE_CHANNELS = ["x", "y", "color", "size"] as const;

export type EncodingValueChannel = (typeof ENCODING_VALUE_CHANNELS)[number];

/**
 * The exact accepted `EncodingValue` shape, in one place, phrased for a human
 * or an agent reading a rejection. Both the command-layer error text and the
 * agent-facing command guide quote this so they cannot drift apart.
 */
export const ENCODING_VALUE_FORMAT =
  'a string "field:<uuid>" or "metric:<uuid>" (a repeat-join instance may suffix the uuid, e.g. "field:<uuid>_j1")';

/**
 * Canonical UUID, optionally carrying the repeat-join instance suffix that
 * `joinInstanceFieldId` appends for the second and later joins to the same
 * table (`<uuid>_j1`, `<uuid>_j2`, …). Selecting a repeat-join instance in the
 * axis picker persists exactly that form, so rejecting it would break a
 * legitimate encoding the UI itself writes.
 *
 * Case-SENSITIVE, deliberately: `parseEncoding` matches the prefix with a
 * case-sensitive `startsWith`, and ids are compared to stored lowercase UUIDs.
 * Admitting `FIELD:<uuid>` here would let a value through the gate that the
 * reader then falls back to treating as a raw column name.
 */
const ENCODING_VALUE_PATTERN =
  /^(?:field|metric):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_j[1-9][0-9]*)?$/;

/**
 * Anything claiming to be an ID reference, well-formed or not. Case-insensitive
 * so a wrong-case prefix is reported as the malformed reference it is, rather
 * than passing as a bare column name.
 */
const ENCODING_PREFIX_PATTERN = /^(?:field|metric):/i;

/**
 * Runtime guard for a value of unknown provenance — an RPC argument, a command
 * envelope authored by an agent, a row read back from storage. Unlike
 * `isValidEncoding`, this takes `unknown` (so a non-string cannot reach it as a
 * type error) and checks the WHOLE shape, not just the prefix.
 *
 * @param value - Candidate of any type
 * @returns True if value is a well-formed `field:<uuid>` / `metric:<uuid>`
 */
export function isEncodingValue(value: unknown): value is EncodingValue {
  return typeof value === "string" && ENCODING_VALUE_PATTERN.test(value);
}

/**
 * Why a channel value is not writable, or undefined when it is.
 *
 * The write gate is deliberately NOT "must be an `EncodingValue`". A bare
 * column name is a form the product itself still produces: the axis picker
 * offers raw data-frame columns while analysis is unavailable, and offers a
 * column that matched no field under its own name, and `resolveToSql` resolves
 * both. Requiring the ID form here would reject the picker's own writes and
 * break duplicating any older chart that stored one.
 *
 * What is NOT writable is the crash class and the near-miss:
 * - a NON-STRING — the render path calls `.startsWith` on channel values, so an
 *   object or number is the defect from GH #289;
 * - a value that CLAIMS to be an ID reference (`field:` / `metric:` prefix) but
 *   carries no valid id — silently unresolvable, and always a caller mistake
 *   rather than a legacy form.
 */
function channelValueProblem(
  channel: string,
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return `encoding.${channel} must be a string — ${ENCODING_VALUE_FORMAT} — received ${describeValue(value)}`;
  }
  // "" is the CLEARED channel, not a malformed one: clearing the optional
  // Color or Size picker saves `""`, and `resolveToSql` short-circuits on it
  // (`if (!value) return undefined`). Rejecting it would break clearing.
  if (value === "") return undefined;
  if (
    ENCODING_PREFIX_PATTERN.test(value) &&
    !ENCODING_VALUE_PATTERN.test(value)
  )
    return `encoding.${channel} looks like an ID reference but is malformed — expected ${ENCODING_VALUE_FORMAT} — received ${describeValue(value)}`;
  return undefined;
}

const AXIS_TYPES = new Set(["quantitative", "nominal", "ordinal", "temporal"]);
const TEMPORAL_AGGREGATIONS = new Set([
  "none",
  "yearWeek",
  "yearMonth",
  "year",
]);
const CATEGORICAL_DATE_GROUPS = new Set(["monthName", "dayOfWeek", "quarter"]);

/**
 * Why a channel transform is not writable, or undefined when it is.
 *
 * `applyTransform` reads `transform.transform.kind` and `applyDateTransformToSql`
 * switches on the inner union without a default, so a half-built transform
 * throws at render exactly like a non-string channel value does. Same class of
 * defect, same gate.
 */
function transformProblem(key: string, value: unknown): string | undefined {
  const shape = `{ type: "date", transform: { kind: "temporal", aggregation: "none"|"yearWeek"|"yearMonth"|"year" } | { kind: "categorical", groupBy: "monthName"|"dayOfWeek"|"quarter" } }`;
  const reject = () =>
    `encoding.${key} must be ${shape} — received ${describeValue(value)}`;

  if (!isPlainObject(value)) return reject();
  if (value.type !== "date") return reject();
  const transform = value.transform;
  if (!isPlainObject(transform)) return reject();
  if (transform.kind === "temporal") {
    return typeof transform.aggregation === "string" &&
      TEMPORAL_AGGREGATIONS.has(transform.aggregation)
      ? undefined
      : reject();
  }
  if (transform.kind === "categorical") {
    return typeof transform.groupBy === "string" &&
      CATEGORICAL_DATE_GROUPS.has(transform.groupBy)
      ? undefined
      : reject();
  }
  return reject();
}

/**
 * Validate a whole `VisualizationEncoding` supplied by an untrusted caller.
 *
 * The render path assumes channel values are strings and transforms are whole,
 * so a structurally wrong encoding written to canonical state throws at RENDER
 * rather than at write — and before the error boundary that took the entire
 * page with it (GH #289). This is the write-time gate: what it rejects can
 * never reach storage.
 *
 * Absent channels are fine — encodings are built up incrementally, and a
 * missing axis already has its own terminal UI.
 *
 * @param encoding - Candidate encoding of any type
 * @returns A human-readable problem description, or undefined when valid
 *
 * @example
 * ```typescript
 * validateVisualizationEncoding({ x: { field: "region" } })
 * // Returns: 'encoding.x must be a string — a string "field:<uuid>" … — received {"field":"region"}'
 * ```
 */
export function validateVisualizationEncoding(
  encoding: unknown,
): string | undefined {
  if (encoding === undefined) return undefined;
  if (!isPlainObject(encoding)) {
    return `encoding must be an object mapping channels to encoding values — received ${describeValue(encoding)}`;
  }

  for (const channel of ENCODING_VALUE_CHANNELS) {
    const value = encoding[channel];
    if (value === undefined) continue;
    const problem = channelValueProblem(channel, value);
    if (problem) return problem;
  }

  for (const key of ["xType", "yType"] as const) {
    const value = encoding[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !AXIS_TYPES.has(value)) {
      return `encoding.${key} must be one of "quantitative", "nominal", "ordinal", "temporal" — received ${describeValue(value)}`;
    }
  }

  for (const key of ["xTransform", "yTransform"] as const) {
    const value = encoding[key];
    if (value === undefined) continue;
    const problem = transformProblem(key, value);
    if (problem) return problem;
  }

  return undefined;
}

/** Narrow to a non-array, non-null object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Render an offending value compactly for an error message. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value !== "object") return `${typeof value} ${String(value)}`;
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

// ============================================================================
// Date Transform Types
// ============================================================================

/**
 * Temporal aggregation - reduces data points while preserving time continuity.
 * Uses DuckDB's `date_trunc()` function to group dates.
 *
 * - `none`: No aggregation, use raw timestamps
 * - `yearWeek`: Group by week (date_trunc('week', col))
 * - `yearMonth`: Group by month (date_trunc('month', col))
 * - `year`: Group by year (date_trunc('year', col))
 *
 * Output is still a timestamp, so x-axis remains temporal (continuous time flow).
 */
export type TemporalAggregation = "none" | "yearWeek" | "yearMonth" | "year";

/**
 * Categorical date grouping - extracts period names for seasonal analysis.
 * Groups data across all years by the extracted period.
 *
 * - `monthName`: Extract month name (monthname(col) → "January", "February", ...)
 * - `dayOfWeek`: Extract day name (dayname(col) → "Monday", "Tuesday", ...)
 * - `quarter`: Extract quarter number (quarter(col) → 1, 2, 3, 4)
 *
 * Output is categorical, so x-axis becomes ordinal (discrete categories).
 */
export type CategoricalDateGroup = "monthName" | "dayOfWeek" | "quarter";

/**
 * Date transform configuration.
 * Discriminated union that determines how date columns are transformed.
 *
 * @example Temporal aggregation (monthly time series)
 * ```typescript
 * const transform: DateTransform = {
 *   kind: 'temporal',
 *   aggregation: 'yearMonth'
 * };
 * // SQL: date_trunc('month', created_at)
 * // Output: 2024-01-01, 2024-02-01, ...
 * // X-axis: temporal (continuous)
 * ```
 *
 * @example Categorical grouping (compare months across years)
 * ```typescript
 * const transform: DateTransform = {
 *   kind: 'categorical',
 *   groupBy: 'monthName'
 * };
 * // SQL: monthname(created_at)
 * // Output: "January", "February", ...
 * // X-axis: ordinal (discrete)
 * ```
 */
export type DateTransform =
  | { kind: "temporal"; aggregation: TemporalAggregation }
  | { kind: "categorical"; groupBy: CategoricalDateGroup };

/**
 * Channel transform configuration for encoding channels (x, y).
 * Currently supports date transforms; extensible for future transform types.
 */
export interface ChannelTransform {
  type: "date";
  transform: DateTransform;
}

// ============================================================================
// Chart Encoding (Rendering Format)
// ============================================================================

/**
 * Axis type for chart encoding.
 */
export type AxisType = "quantitative" | "nominal" | "ordinal" | "temporal";

/**
 * Chart encoding for rendering - uses plain strings (column names or SQL expressions).
 *
 * This is the format the vgplot renderer expects:
 * - Column names: "category", "revenue"
 * - SQL aggregations: "sum(revenue)", "avg(price)"
 * - Date functions: "dateMonth(created)"
 *
 * Use `resolveEncodingToChart` to convert from `VisualizationEncoding` (ID-based) to this format.
 */
export interface ChartEncoding {
  x?: string;
  y?: string;
  xType?: AxisType;
  yType?: AxisType;
  color?: string;
  size?: string;

  /**
   * Human-readable axis labels for display in chart UI.
   * These are the field/metric names shown on axes, legends, and tooltips.
   *
   * When set, the renderer should use these labels instead of the column names
   * (which may be UUID-based for consistency).
   */
  xLabel?: string;
  yLabel?: string;
  colorLabel?: string;
  sizeLabel?: string;

  /**
   * Date transform applied to X-axis (when X is temporal).
   * Used by renderer to determine interval for rectY marks.
   */
  xTransform?: ChannelTransform;
  /**
   * Date transform applied to Y-axis (when Y is temporal).
   * Used by renderer to determine interval for rectX marks.
   */
  yTransform?: ChannelTransform;
}
