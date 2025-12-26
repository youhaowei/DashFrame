/**
 * Column Analysis Types
 *
 * Discriminated union types for column analysis with type-specific stats.
 * Used for chart suggestions, encoding decisions, and data categorization.
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Common fields shared by all column analysis types.
 */
export type ColumnAnalysisBase = {
  /** Column name (may be UUID-aliased like "field_abc123") */
  columnName: string;
  /** Optional field ID for linking back to Field entity */
  fieldId?: string;
  /** Number of distinct non-null values */
  cardinality: number;
  /** Ratio of unique values to non-null values (0-1) */
  uniqueness: number;
  /** Number of null/undefined values */
  nullCount: number;
  /** Sample of distinct values for preview/pattern detection */
  sampleValues: unknown[];
};

// ============================================================================
// Semantic Types per Data Type
// ============================================================================

/** Semantic meanings for string columns */
export type StringSemantic =
  | "text" // Free-form text, high cardinality
  | "identifier" // Unique ID (e.g., UUID, slug)
  | "email" // Email addresses
  | "url" // URLs
  | "uuid" // UUID format specifically
  | "categorical"; // Low cardinality, discrete values

/** Semantic meanings for number columns */
export type NumberSemantic =
  | "numerical" // Continuous numeric values
  | "identifier"; // Numeric IDs (e.g., auto-increment)

/** Semantic meanings for date columns */
export type DateSemantic = "temporal";

/** Semantic meanings for boolean columns */
export type BooleanSemantic = "boolean";

/** Semantic meanings for array columns */
export type ArraySemantic = "reference"; // e.g., Notion relation arrays

/** Semantic meanings for unknown columns */
export type UnknownSemantic = "unknown";

// ============================================================================
// Type-Specific Analysis
// ============================================================================

/**
 * Analysis for string columns.
 * Includes length stats and pattern detection.
 */
export type StringAnalysis = ColumnAnalysisBase & {
  dataType: "string";
  semantic: StringSemantic;
  /** Minimum string length */
  minLength?: number;
  /** Maximum string length */
  maxLength?: number;
  /** Average string length */
  avgLength?: number;
  /** Detected pattern (e.g., "email", "url", "uuid") */
  pattern?: string;
  /** Ratio of most frequent value to total rows (0-1). High = dominated by one value */
  maxFrequencyRatio?: number;
};

/**
 * Analysis for numeric columns.
 * Includes statistical measures.
 */
export type NumberAnalysis = ColumnAnalysisBase & {
  dataType: "number";
  semantic: NumberSemantic;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Standard deviation */
  stdDev?: number;
  /** Count of zero values */
  zeroCount?: number;
};

/**
 * Analysis for date/time columns.
 * Includes date range for transform auto-selection.
 */
export type DateAnalysis = ColumnAnalysisBase & {
  dataType: "date";
  semantic: DateSemantic;
  /** Minimum date (ms since epoch) */
  minDate: number;
  /** Maximum date (ms since epoch) */
  maxDate: number;
};

/**
 * Analysis for boolean columns.
 * Includes true/false distribution.
 */
export type BooleanAnalysis = ColumnAnalysisBase & {
  dataType: "boolean";
  semantic: BooleanSemantic;
  /** Count of true values */
  trueCount: number;
  /** Count of false values */
  falseCount: number;
};

/**
 * Analysis for array columns (e.g., Notion relations).
 */
export type ArrayAnalysis = ColumnAnalysisBase & {
  dataType: "array";
  semantic: ArraySemantic;
  /** Average array length */
  avgLength?: number;
};

/**
 * Analysis for columns with unknown/unsupported types.
 */
export type UnknownAnalysis = ColumnAnalysisBase & {
  dataType: "unknown";
  semantic: UnknownSemantic;
};

// ============================================================================
// Union Type
// ============================================================================

/**
 * Discriminated union of all column analysis types.
 * Switch on `dataType` to access type-specific fields.
 *
 * @example
 * ```typescript
 * function getRange(col: ColumnAnalysis): string {
 *   switch (col.dataType) {
 *     case 'number':
 *       return `${col.min} - ${col.max}`;
 *     case 'date':
 *       return `${new Date(col.minDate)} - ${new Date(col.maxDate)}`;
 *     default:
 *       return 'N/A';
 *   }
 * }
 * ```
 */
export type ColumnAnalysis =
  | StringAnalysis
  | NumberAnalysis
  | DateAnalysis
  | BooleanAnalysis
  | ArrayAnalysis
  | UnknownAnalysis;

/**
 * All possible data types for column analysis.
 */
export type ColumnDataType = ColumnAnalysis["dataType"];

/**
 * All possible semantic types for column analysis.
 * This is the union of all semantic types across all data types.
 */
export type ColumnSemantic =
  | StringSemantic
  | NumberSemantic
  | DateSemantic
  | BooleanSemantic
  | ArraySemantic
  | UnknownSemantic;

// ============================================================================
// DataFrame Analysis (Cached)
// ============================================================================

/**
 * Complete analysis results for a DataFrame.
 * Stored on DataFrameEntity for caching.
 */
export type DataFrameAnalysis = {
  /** Analysis for each column */
  columns: ColumnAnalysis[];
  /** Total row count at time of analysis */
  rowCount: number;
  /** Timestamp when analysis was performed (ms since epoch) */
  analyzedAt: number;
  /** Hash of field IDs for cache invalidation */
  fieldHash: string;
};

// ============================================================================
// Legacy Compatibility - ColumnCategory
// ============================================================================

/**
 * Legacy column category type for backward compatibility.
 * Maps to semantic types in the new discriminated union.
 *
 * @deprecated Use `ColumnAnalysis` discriminated union with `dataType` and `semantic` instead.
 */
export type ColumnCategory =
  | "identifier"
  | "reference"
  | "email"
  | "url"
  | "uuid"
  | "categorical"
  | "numerical"
  | "temporal"
  | "boolean"
  | "text"
  | "unknown";

/**
 * Extract legacy category from new ColumnAnalysis type.
 * Useful during migration period.
 */
export function getLegacyCategory(analysis: ColumnAnalysis): ColumnCategory {
  return analysis.semantic as ColumnCategory;
}

// ============================================================================
// Cardinality Thresholds
// ============================================================================

/**
 * Cardinality thresholds for column categorization and validation.
 * Used by suggest-charts, axis-warnings, and encoding-criteria.
 */
export const CARDINALITY_THRESHOLDS = {
  /** Max categories for readable color legend */
  COLOR_MAX: 12,
  /** Min categories for color to be useful */
  COLOR_MIN: 2,
  /** Max categories for X-axis readability */
  CATEGORICAL_X_MAX: 50,
  /** Cardinality ratio threshold for categorical detection (relative to row count) */
  CATEGORICAL_RATIO: 0.2,
} as const;

// ============================================================================
// Identifier Detection
// ============================================================================

/** Patterns that indicate a column is an identifier */
const ID_NAME_PATTERNS = [
  /^id$/i,
  /_id$/i,
  /^id_/i,
  /Id$/, // camelCase: userId
  /^uuid$/i,
  /^guid$/i,
  /^_rowindex$/i,
  /^rowindex$/i,
  /key$/i,
  /^pk$/i,
];

/** Patterns that look like IDs but aren't (false positives) */
const NOT_ID_PATTERNS = [/zipcode$/i, /postcode$/i, /areacode$/i];

/**
 * Check if a column name looks like an identifier.
 *
 * @param name - Column name to check
 * @returns true if the column name matches identifier patterns
 */
export function looksLikeIdentifier(name: string): boolean {
  if (NOT_ID_PATTERNS.some((p) => p.test(name))) return false;
  return ID_NAME_PATTERNS.some((p) => p.test(name));
}
