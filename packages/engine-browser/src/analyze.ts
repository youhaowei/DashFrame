import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import {
  type DataFrameColumn,
  type Field,
  extractUUIDFromColumnAlias,
} from "@dashframe/engine";
import type {
  ColumnAnalysis,
  StringAnalysis,
  NumberAnalysis,
  DateAnalysis,
  BooleanAnalysis,
  UnknownAnalysis,
} from "@dashframe/types";
import { CARDINALITY_THRESHOLDS } from "@dashframe/types";
import { Insight } from "./insight";

// Re-export types and utilities from @dashframe/types for backward compatibility
export type { ColumnAnalysis, DataFrameAnalysis } from "@dashframe/types";
export type { ColumnCategory } from "@dashframe/types";
export { looksLikeIdentifier, CARDINALITY_THRESHOLDS } from "@dashframe/types";

// Pattern detection helpers
// Safe regex patterns that avoid catastrophic backtracking (ReDoS)
// Using more specific patterns with length limits for sample value detection
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const URL_PATTERN = /^https?:\/\/[^\s]{1,2048}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isEmail = (value: string): boolean => {
  // Length check to prevent ReDoS on extremely long strings
  if (value.length > 320) return false;
  return EMAIL_PATTERN.test(value);
};

const isURL = (value: string): boolean => {
  // Length check to prevent ReDoS on extremely long strings
  if (value.length > 2048) return false;
  return URL_PATTERN.test(value);
};

const isUUID = (value: string): boolean => UUID_PATTERN.test(value);

// Helper functions for column analysis
type ColumnStats = {
  column_name: string;
  cardinality: bigint;
  null_count: bigint;
  data_type: string;
  min_val: number | null;
  max_val: number | null;
  std_dev: number | null;
  zero_count: bigint;
  min_date: bigint | null;
  max_date: bigint | null;
};

type BaseProps = {
  columnName: string;
  cardinality: number;
  uniqueness: number;
  nullCount: number;
  sampleValues: unknown[];
};

/**
 * Check if a numeric column name matches ID patterns
 */
function isNumericIdPattern(
  columnName: string,
  isExplicitIdentifier: boolean,
): boolean {
  if (isExplicitIdentifier) return true;

  const colName = columnName.toLowerCase();
  const numericIdPatterns = [
    /id$/,
    /_id$/,
    /^id$/,
    /^id_/,
    /key$/,
    /no$/,
    /num$/,
    /index$/,
    /seq$/,
  ];
  const notIdPatterns = [/zipcode$/, /postcode$/, /areacode$/];

  return (
    numericIdPatterns.some((p) => p.test(colName)) &&
    !notIdPatterns.some((p) => p.test(colName))
  );
}

/**
 * Detect string pattern type (email, url, uuid) from sample values
 */
function detectStringPattern(
  stringValues: string[],
): "email" | "url" | "uuid" | null {
  if (stringValues.length === 0) return null;

  const threshold = stringValues.length * 0.8;
  const emailCount = stringValues.filter(isEmail).length;
  const urlCount = stringValues.filter(isURL).length;
  const uuidCount = stringValues.filter(isUUID).length;

  if (emailCount >= threshold) return "email";
  if (urlCount >= threshold) return "url";
  if (uuidCount >= threshold) return "uuid";
  return null;
}

/**
 * Compute string length statistics
 */
function computeStringLengthStats(stringValues: string[]): {
  minLength: number;
  maxLength: number;
  avgLength: number;
} {
  const lengths = stringValues.map((s) => s.length);
  const minLength = Math.min(...lengths);
  const maxLength = Math.max(...lengths);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  return { minLength, maxLength, avgLength };
}

/**
 * Check if a string column matches identifier patterns
 */
function isStringIdentifier(
  columnName: string,
  isExplicitIdentifier: boolean,
  uniqueness: number,
  rowCount: number,
): boolean {
  if (isExplicitIdentifier) return true;

  const colName = columnName.toLowerCase();
  const idPatterns = [
    /_id$/,
    /^id$/,
    /^id_/,
    /^uuid$/,
    /^guid$/,
    /^_rowindex$/,
  ];
  const camelCaseId = /[a-z]Id$/.test(columnName);

  return (
    idPatterns.some((p) => p.test(colName)) ||
    camelCaseId ||
    (uniqueness === 1 && rowCount > 1)
  );
}

/**
 * Analyze boolean column
 */
function analyzeBoolean(
  baseProps: BaseProps,
  sampleValues: unknown[],
): BooleanAnalysis {
  const trueCount = sampleValues.filter(
    (v) => v === true || v === "true",
  ).length;
  const falseCount = sampleValues.filter(
    (v) => v === false || v === "false",
  ).length;

  return {
    ...baseProps,
    dataType: "boolean",
    semantic: "boolean",
    trueCount,
    falseCount,
  };
}

/**
 * Analyze numeric column
 *
 * @param displayName - The user-visible field name (for ID pattern detection).
 *                      With UUID-based column aliases, we need the original field
 *                      name to detect patterns like "oppid" ending with "id".
 */
function analyzeNumeric(
  baseProps: BaseProps,
  stats: ColumnStats,
  isExplicitIdentifier: boolean,
  displayName: string,
): NumberAnalysis {
  const minVal = stats.min_val ?? 0;
  const maxVal = stats.max_val ?? 0;
  const stdDev = stats.std_dev ?? undefined;
  const zeroCount = Number(stats.zero_count);

  // Use displayName for pattern matching (not UUID alias)
  const isNumericId = isNumericIdPattern(displayName, isExplicitIdentifier);

  return {
    ...baseProps,
    dataType: "number",
    semantic: isNumericId ? "identifier" : "numerical",
    min: minVal,
    max: maxVal,
    stdDev,
    zeroCount,
  };
}

/**
 * Analyze date/time column
 */
function analyzeDate(baseProps: BaseProps, stats: ColumnStats): DateAnalysis {
  const minDate = stats.min_date != null ? Number(stats.min_date) : Date.now();
  const maxDate = stats.max_date != null ? Number(stats.max_date) : Date.now();

  return {
    ...baseProps,
    dataType: "date",
    semantic: "temporal",
    minDate,
    maxDate,
  };
}

/**
 * Analyze string column with pattern and semantic detection
 *
 * @param displayName - The user-visible field name (for ID pattern detection).
 *                      With UUID-based column aliases, we need the original field
 *                      name to detect patterns like "oppid" ending with "id".
 */
function analyzeString(
  baseProps: BaseProps,
  _stats: ColumnStats,
  stringValues: string[],
  isExplicitIdentifier: boolean,
  maxFrequencyRatio: number | undefined,
  rowCount: number,
  displayName: string,
): StringAnalysis {
  if (stringValues.length === 0) {
    return {
      ...baseProps,
      dataType: "string",
      semantic: "categorical",
      maxFrequencyRatio,
    };
  }

  const { minLength, maxLength, avgLength } =
    computeStringLengthStats(stringValues);
  const stringProps = {
    ...baseProps,
    dataType: "string" as const,
    minLength,
    maxLength,
    avgLength,
    maxFrequencyRatio,
  };

  // Check for pattern matches (email, url, uuid)
  const pattern = detectStringPattern(stringValues);
  if (pattern) {
    return {
      ...stringProps,
      semantic: pattern,
      pattern,
    };
  }

  // Check for identifier patterns using displayName (not UUID alias)
  if (
    isStringIdentifier(
      displayName,
      isExplicitIdentifier,
      baseProps.uniqueness,
      rowCount,
    )
  ) {
    return {
      ...stringProps,
      semantic: "identifier",
    };
  }

  // Categorical vs text based on cardinality
  const cardinality = baseProps.cardinality;
  if (
    cardinality < rowCount * CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO ||
    cardinality < 50
  ) {
    return {
      ...stringProps,
      semantic: "categorical",
    };
  }

  // Default to text for high-cardinality strings
  return {
    ...stringProps,
    semantic: "text",
  };
}

/**
 * Analyze a DuckDB table using SQL queries for accurate full-dataset statistics.
 * Uses SQL aggregations for cardinality, null counts, and type detection.
 *
 * Performance: Uses batched queries to reduce round-trips from 2N+1 to 2 queries.
 *
 * @param conn - DuckDB connection
 * @param tableName - Name of the table to analyze (already loaded in DuckDB)
 * @param columns - Column definitions (for column names)
 * @param fields - Optional field metadata for explicit categorization
 * @param totalRows - Optional total row count to skip COUNT(*) query
 * @returns Array of column analysis results
 */
export async function analyzeDataFrame(
  conn: AsyncDuckDBConnection,
  tableName: string,
  columns: DataFrameColumn[],
  fields?: Record<string, Field>,
  totalRows?: number,
): Promise<ColumnAnalysis[]> {
  const columnNames = columns.map((col) => col.name);
  const quotedTable = `"${tableName}"`;

  // Get total row count (skip if provided)
  let rowCount: number;
  if (totalRows !== undefined) {
    rowCount = totalRows;
  } else {
    const countResult = await conn.query(
      `SELECT COUNT(*) as cnt FROM ${quotedTable}`,
    );
    rowCount = Number((countResult.toArray()[0] as { cnt: bigint }).cnt);
  }

  // Build batched stats query for all columns (UNION ALL)
  // Includes both numeric stats (min/max/stddev) and temporal stats (min_date/max_date)
  const statsQuery = columnNames
    .map((columnName) => {
      const quotedColumn = `"${columnName}"`;
      return `
        SELECT
          '${columnName.replace(/'/g, "''")}' as column_name,
          COUNT(DISTINCT ${quotedColumn}) as cardinality,
          COUNT(*) - COUNT(${quotedColumn}) as null_count,
          ANY_VALUE(typeof(${quotedColumn})) as data_type,
          MIN(TRY_CAST(${quotedColumn} AS DOUBLE)) as min_val,
          MAX(TRY_CAST(${quotedColumn} AS DOUBLE)) as max_val,
          STDDEV(TRY_CAST(${quotedColumn} AS DOUBLE)) as std_dev,
          COUNT(CASE WHEN TRY_CAST(${quotedColumn} AS DOUBLE) = 0 THEN 1 END) as zero_count,
          -- Temporal stats: extract epoch_ms for date range detection
          epoch_ms(MIN(TRY_CAST(${quotedColumn} AS TIMESTAMP))) as min_date,
          epoch_ms(MAX(TRY_CAST(${quotedColumn} AS TIMESTAMP))) as max_date
        FROM ${quotedTable}
      `;
    })
    .join(" UNION ALL ");

  // Build batched samples query for all columns (UNION ALL)
  const samplesQuery = columnNames
    .map((columnName) => {
      const quotedColumn = `"${columnName}"`;
      return `
        SELECT '${columnName.replace(/'/g, "''")}' as col, ${quotedColumn}::VARCHAR as value
        FROM (SELECT DISTINCT ${quotedColumn} FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL LIMIT 10)
      `;
    })
    .join(" UNION ALL ");

  // Build batched max frequency query for categorical columns
  // This finds the count of the most common value for each column
  const maxFreqQuery = columnNames
    .map((columnName) => {
      const quotedColumn = `"${columnName}"`;
      return `
        SELECT '${columnName.replace(/'/g, "''")}' as column_name, MAX(cnt) as max_freq
        FROM (SELECT COUNT(*) as cnt FROM ${quotedTable} GROUP BY ${quotedColumn})
      `;
    })
    .join(" UNION ALL ");

  // Execute all queries in parallel (3 queries total instead of 3N)
  const [statsResult, samplesResult, maxFreqResult] = await Promise.all([
    conn.query(statsQuery),
    conn.query(samplesQuery),
    conn.query(maxFreqQuery),
  ]);

  // Parse stats results
  const statsRows = statsResult.toArray() as {
    column_name: string;
    cardinality: bigint;
    null_count: bigint;
    data_type: string;
    min_val: number | null;
    max_val: number | null;
    std_dev: number | null;
    zero_count: bigint;
    min_date: bigint | null;
    max_date: bigint | null;
  }[];

  // Parse samples results and group by column
  const samplesRows = samplesResult.toArray() as {
    col: string;
    value: unknown;
  }[];
  const samplesByColumn = new Map<string, unknown[]>();
  for (const row of samplesRows) {
    if (!samplesByColumn.has(row.col)) {
      samplesByColumn.set(row.col, []);
    }
    samplesByColumn.get(row.col)!.push(row.value);
  }

  // Parse max frequency results
  const maxFreqRows = maxFreqResult.toArray() as {
    column_name: string;
    max_freq: bigint;
  }[];
  const maxFreqByColumn = new Map<string, number>();
  for (const row of maxFreqRows) {
    maxFreqByColumn.set(row.column_name, Number(row.max_freq));
  }

  // Process each column's analysis
  const analyses: ColumnAnalysis[] = statsRows.map((stats) => {
    const columnName = stats.column_name;
    const sampleValues = samplesByColumn.get(columnName) ?? [];

    try {
      const cardinality = Number(stats.cardinality);
      const nullCount = Number(stats.null_count);
      const duckDBType = (stats.data_type || "unknown").toLowerCase();
      const nonNullCount = rowCount - nullCount;
      const uniqueness = nonNullCount > 0 ? cardinality / nonNullCount : 0;

      // Compute max frequency ratio (what % of rows have the most common value)
      const maxFreq = maxFreqByColumn.get(columnName) ?? 0;
      const maxFrequencyRatio = rowCount > 0 ? maxFreq / rowCount : undefined;

      // Base properties shared by all types
      const baseProps: BaseProps = {
        columnName,
        cardinality,
        uniqueness,
        nullCount,
        sampleValues: sampleValues.slice(0, 5),
      };

      // Helper to check field metadata
      // Column names are UUID-based aliases (e.g., field_<uuid>), so we need to extract
      // the UUID and look up the field to get the actual field name for pattern matching
      const fieldId = extractUUIDFromColumnAlias(columnName);
      const field = fieldId ? fields?.[fieldId] : undefined;
      const isExplicitIdentifier = field?.isIdentifier ?? false;
      const isExplicitReference = field?.isReference ?? false;
      // Use the actual field name for ID pattern detection, not the UUID alias
      const displayName = field?.name ?? columnName;

      // String values for pattern detection
      const stringValues = sampleValues
        .map((v) => String(v))
        .filter((v) => v.length > 0);

      // Determine dataType and semantic based on DuckDB type and heuristics
      if (duckDBType === "boolean" || duckDBType === "bool") {
        return analyzeBoolean(baseProps, sampleValues);
      }

      if (
        duckDBType.includes("int") ||
        duckDBType.includes("float") ||
        duckDBType.includes("double") ||
        duckDBType.includes("decimal") ||
        duckDBType.includes("numeric") ||
        duckDBType.includes("bigint")
      ) {
        return analyzeNumeric(
          baseProps,
          stats,
          isExplicitIdentifier,
          displayName,
        );
      }

      if (
        duckDBType.includes("date") ||
        duckDBType.includes("time") ||
        duckDBType.includes("timestamp")
      ) {
        return analyzeDate(baseProps, stats);
      }

      if (
        duckDBType.includes("[]") ||
        duckDBType.includes("list") ||
        isExplicitReference
      ) {
        return {
          ...baseProps,
          dataType: "array",
          semantic: "reference",
          avgLength: undefined, // TODO: compute if needed
        };
      }

      if (
        duckDBType.includes("varchar") ||
        duckDBType.includes("string") ||
        duckDBType.includes("text")
      ) {
        return analyzeString(
          baseProps,
          stats,
          stringValues,
          isExplicitIdentifier,
          maxFrequencyRatio,
          rowCount,
          displayName,
        );
      }

      // Unknown type
      return {
        ...baseProps,
        dataType: "unknown",
        semantic: "unknown",
      } as UnknownAnalysis;
    } catch (error) {
      console.warn(
        `[analyzeDataFrame] Error analyzing column ${columnName}:`,
        error,
      );
      return {
        columnName,
        dataType: "unknown",
        semantic: "unknown",
        cardinality: 0,
        uniqueness: 0,
        nullCount: 0,
        sampleValues: [],
      } as UnknownAnalysis;
    }
  });

  return analyses;
}

// ============================================================================
// Join Column Suggestion
// ============================================================================

export type JoinSuggestion = {
  leftColumn: string;
  rightColumn: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

// Helper functions for join column suggestion
function isInternalColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("_") || // Internal columns like _rowIndex
    lower === "rowindex" ||
    lower === "row_index"
  );
}

function typesCompatible(left: ColumnAnalysis, right: ColumnAnalysis): boolean {
  const leftSem = left.semantic;
  const rightSem = right.semantic;
  // Identifiers and references are always compatible
  if (
    (leftSem === "identifier" || leftSem === "reference") &&
    (rightSem === "identifier" || rightSem === "reference")
  ) {
    return true;
  }
  // Same semantic is compatible
  if (leftSem === rightSem) return true;
  // Numerical can join with identifier (foreign keys are often numeric)
  if (
    (leftSem === "numerical" && rightSem === "identifier") ||
    (leftSem === "identifier" && rightSem === "numerical")
  ) {
    return true;
  }
  return false;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

function extractBaseName(name: string): string | null {
  const lower = name.toLowerCase();
  // Match patterns like user_id, userId, user-id
  const match = lower.match(/^(.+?)[-_]?id$/i);
  return match ? match[1].replace(/[-_]/g, "") : null;
}

function isAlreadySuggested(
  suggestions: JoinSuggestion[],
  leftColumn: string,
  rightColumn: string,
): boolean {
  return suggestions.some(
    (s) => s.leftColumn === leftColumn && s.rightColumn === rightColumn,
  );
}

function isLeftColumnSuggested(
  suggestions: JoinSuggestion[],
  columnName: string,
): boolean {
  return suggestions.some((s) => s.leftColumn === columnName);
}

function isRightColumnSuggested(
  suggestions: JoinSuggestion[],
  columnName: string,
): boolean {
  return suggestions.some((s) => s.rightColumn === columnName);
}

/**
 * Strategy 1: Exact name match on identifier/reference columns
 */
function findExactNameMatches(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];

  for (const leftCol of leftAnalysis) {
    if (leftCol.semantic !== "identifier" && leftCol.semantic !== "reference")
      continue;

    for (const rightCol of rightAnalysis) {
      if (
        rightCol.semantic !== "identifier" &&
        rightCol.semantic !== "reference"
      )
        continue;

      if (
        normalizeName(leftCol.columnName) === normalizeName(rightCol.columnName)
      ) {
        suggestions.push({
          leftColumn: leftCol.columnName,
          rightColumn: rightCol.columnName,
          confidence: "high",
          reason: `Exact match on "${leftCol.columnName}"`,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Strategy 2: Reference pattern matching (users.id → orders.user_id)
 */
function findReferencePatternMatches(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
  leftTableName: string,
  existingSuggestions: JoinSuggestion[],
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];
  const leftIdCol = leftAnalysis.find(
    (col) =>
      col.columnName.toLowerCase() === "id" &&
      (col.semantic === "identifier" || col.semantic === "reference"),
  );

  if (!leftIdCol) return suggestions;

  const tableBaseName = normalizeName(leftTableName.replace(/s$/, "")); // "users" → "user"

  for (const rightCol of rightAnalysis) {
    const fkBaseName = extractBaseName(rightCol.columnName);
    if (fkBaseName && fkBaseName === tableBaseName) {
      if (
        !isAlreadySuggested(
          existingSuggestions,
          leftIdCol.columnName,
          rightCol.columnName,
        )
      ) {
        suggestions.push({
          leftColumn: leftIdCol.columnName,
          rightColumn: rightCol.columnName,
          confidence: "high",
          reason: `Foreign key pattern: ${leftTableName}.id → ${rightCol.columnName}`,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Strategy 2b: Reverse reference pattern (orders.user_id → users.id)
 */
function findReverseReferencePatternMatches(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
  rightTableName: string,
  existingSuggestions: JoinSuggestion[],
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];
  const rightIdCol = rightAnalysis.find(
    (col) =>
      col.columnName.toLowerCase() === "id" &&
      (col.semantic === "identifier" || col.semantic === "reference"),
  );

  if (!rightIdCol) return suggestions;

  const tableBaseName = normalizeName(rightTableName.replace(/s$/, "")); // "users" → "user"

  for (const leftCol of leftAnalysis) {
    const fkBaseName = extractBaseName(leftCol.columnName);
    if (fkBaseName && fkBaseName === tableBaseName) {
      if (
        !isAlreadySuggested(
          existingSuggestions,
          leftCol.columnName,
          rightIdCol.columnName,
        )
      ) {
        suggestions.push({
          leftColumn: leftCol.columnName,
          rightColumn: rightIdCol.columnName,
          confidence: "high",
          reason: `Foreign key pattern: ${leftCol.columnName} → ${rightTableName}.id`,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Strategy 3: Same name with compatible types (non-ID columns)
 */
function findSameNameMatches(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
  existingSuggestions: JoinSuggestion[],
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];

  for (const leftCol of leftAnalysis) {
    if (isLeftColumnSuggested(existingSuggestions, leftCol.columnName))
      continue;

    for (const rightCol of rightAnalysis) {
      if (isRightColumnSuggested(existingSuggestions, rightCol.columnName))
        continue;

      if (
        normalizeName(leftCol.columnName) ===
          normalizeName(rightCol.columnName) &&
        typesCompatible(leftCol, rightCol)
      ) {
        suggestions.push({
          leftColumn: leftCol.columnName,
          rightColumn: rightCol.columnName,
          confidence: "medium",
          reason: `Same column name "${leftCol.columnName}" with compatible types`,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Check if a left column matches a foreign key base name
 */
function matchesForeignKeyBase(
  leftCol: ColumnAnalysis,
  fkBaseName: string,
): boolean {
  const leftBaseName =
    extractBaseName(leftCol.columnName) || normalizeName(leftCol.columnName);
  return (
    leftBaseName === fkBaseName ||
    normalizeName(leftCol.columnName) === fkBaseName
  );
}

/**
 * Strategy 4: ID pattern matching (look for *_id in right that might match left identifiers)
 */
function findIdPatternMatches(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
  existingSuggestions: JoinSuggestion[],
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];
  const identifierLeftCols = leftAnalysis.filter(
    (col) => col.semantic === "identifier",
  );

  for (const rightCol of rightAnalysis) {
    if (isRightColumnSuggested(existingSuggestions, rightCol.columnName))
      continue;

    const fkBaseName = extractBaseName(rightCol.columnName);
    if (!fkBaseName) continue;

    for (const leftCol of identifierLeftCols) {
      if (isLeftColumnSuggested(existingSuggestions, leftCol.columnName))
        continue;

      if (matchesForeignKeyBase(leftCol, fkBaseName)) {
        suggestions.push({
          leftColumn: leftCol.columnName,
          rightColumn: rightCol.columnName,
          confidence: "low",
          reason: `Potential foreign key: ${leftCol.columnName} → ${rightCol.columnName}`,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Suggest join columns between two datasets based on column analysis.
 *
 * Matching strategies (in priority order):
 * 1. Exact name match on identifier columns (user_id = user_id) → high confidence
 * 2. Reference pattern: left.id matches right.*_id (users.id → orders.user_id) → high confidence
 * 2b. Reverse reference: left.*_id matches right.id (orders.user_id → users.id) → high confidence
 * 3. Same name with compatible types → medium confidence
 * 4. Identifier columns with matching types → low confidence
 *
 * @param leftAnalysis - Column analysis of the left (base) table
 * @param rightAnalysis - Column analysis of the right (join) table
 * @param leftTableName - Optional name of left table for reference pattern matching
 * @param rightTableName - Optional name of right table for reverse reference pattern matching
 * @returns Array of join suggestions sorted by confidence
 */
export function suggestJoinColumns(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
  leftTableName?: string,
  rightTableName?: string,
): JoinSuggestion[] {
  // Filter analyses to exclude internal columns
  const filteredLeftAnalysis = leftAnalysis.filter(
    (col) => !isInternalColumn(col.columnName),
  );
  const filteredRightAnalysis = rightAnalysis.filter(
    (col) => !isInternalColumn(col.columnName),
  );

  const suggestions: JoinSuggestion[] = [];

  // Strategy 1: Exact name match on identifier/reference columns
  suggestions.push(
    ...findExactNameMatches(filteredLeftAnalysis, filteredRightAnalysis),
  );

  // Strategy 2: Reference pattern matching (users.id → orders.user_id)
  if (leftTableName) {
    suggestions.push(
      ...findReferencePatternMatches(
        filteredLeftAnalysis,
        filteredRightAnalysis,
        leftTableName,
        suggestions,
      ),
    );
  }

  // Strategy 2b: Reverse reference pattern (orders.user_id → users.id)
  if (rightTableName) {
    suggestions.push(
      ...findReverseReferencePatternMatches(
        filteredLeftAnalysis,
        filteredRightAnalysis,
        rightTableName,
        suggestions,
      ),
    );
  }

  // Strategy 3: Same name with compatible types (non-ID columns)
  suggestions.push(
    ...findSameNameMatches(
      filteredLeftAnalysis,
      filteredRightAnalysis,
      suggestions,
    ),
  );

  // Strategy 4: ID pattern matching
  suggestions.push(
    ...findIdPatternMatches(
      filteredLeftAnalysis,
      filteredRightAnalysis,
      suggestions,
    ),
  );

  // Sort by confidence (high → medium → low)
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort(
    (a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence],
  );

  return suggestions;
}

// ============================================================================
// View Analysis - Run DuckDB analysis on an existing view/table
// ============================================================================

/**
 * Analyze an existing DuckDB view or table.
 *
 * Use this when you already have a view created (e.g., via useInsightView)
 * that has the correct column names (UUID-based aliases).
 *
 * @param conn - DuckDB connection
 * @param viewName - Name of the existing view or table to analyze
 * @returns Column analysis for all columns in the view
 */
export async function analyzeView(
  conn: AsyncDuckDBConnection,
  viewName: string,
): Promise<ColumnAnalysis[]> {
  try {
    // 1. Get column info from the view
    const columnsResult = await conn.query(`DESCRIBE "${viewName}"`);
    const columnsArray = columnsResult.toArray();

    // Build columns array with type info
    const columns: DataFrameColumn[] = columnsArray.map((row) => ({
      name: String(row.column_name),
      type: mapDuckDBTypeToDataFrameType(String(row.column_type)),
    }));

    // 2. Get row count for analysis
    const countResult = await conn.query(
      `SELECT COUNT(*) as cnt FROM "${viewName}"`,
    );
    const totalRows = Number(countResult.toArray()[0]?.cnt ?? 0);

    // 3. Run full analysis on the view
    const analysis = await analyzeDataFrame(
      conn,
      viewName,
      columns,
      undefined, // fields - not needed, analysis infers from data
      totalRows,
    );

    return analysis;
  } catch (e) {
    // If view doesn't exist, return empty analysis
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (
      errorMessage.includes("does not exist") ||
      errorMessage.includes("not found")
    ) {
      console.debug("[analyzeView] View not found, skipping analysis");
      return [];
    }
    throw e; // Re-throw other errors
  }
}

// ============================================================================
// Insight Analysis - Run DuckDB analysis on Insight result (LEGACY)
// ============================================================================

/**
 * Analyze an Insight's result using DuckDB.
 *
 * @deprecated Use `analyzeView()` with a view created by `useInsightView()` instead.
 * This function uses `insight.toSQL()` which generates original column names,
 * not UUID-based aliases. For consistent column naming with visualizations,
 * use the view created by useInsightView and analyze with `analyzeView()`.
 *
 * Uses `insight.toSQL()` to get the query (handles joins, aggregation, filters),
 * then runs full statistical analysis on the result columns.
 *
 * @param conn - DuckDB connection
 * @param insight - Insight instance with toSQL() method
 * @returns Column analysis for all columns in the Insight result
 */
export async function analyzeInsight(
  conn: AsyncDuckDBConnection,
  insight: Insight,
): Promise<ColumnAnalysis[]> {
  const tempViewName = `__insight_analysis_${Date.now()}`;

  try {
    // 1. Get SQL from Insight (handles joins, aggregation, GROUP BY)
    const insightSQL = insight.toSQL();

    // 2. Create temporary view from Insight SQL
    // This may fail if tables haven't been loaded into DuckDB yet
    try {
      await conn.query(
        `CREATE OR REPLACE TEMP VIEW "${tempViewName}" AS ${insightSQL}`,
      );
    } catch (e) {
      // If table doesn't exist, return empty analysis
      // The caller's effect will re-run when tables are loaded
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (errorMessage.includes("does not exist")) {
        console.debug(
          "[analyzeInsight] Tables not yet loaded, skipping analysis",
        );
        return [];
      }
      throw e; // Re-throw other errors
    }

    // 3. Get column info from the view
    const columnsResult = await conn.query(`DESCRIBE "${tempViewName}"`);
    const columnsArray = columnsResult.toArray();

    // Build columns array with type info
    const columns: DataFrameColumn[] = columnsArray.map((row) => ({
      name: String(row.column_name),
      type: mapDuckDBTypeToDataFrameType(String(row.column_type)),
    }));

    // 4. Get row count for analysis
    const countResult = await conn.query(
      `SELECT COUNT(*) as cnt FROM "${tempViewName}"`,
    );
    const totalRows = Number(countResult.toArray()[0]?.cnt ?? 0);

    // 5. Run full analysis on the view
    const analysis = await analyzeDataFrame(
      conn,
      tempViewName,
      columns,
      undefined, // fields - not needed, analysis infers from data
      totalRows,
    );

    return analysis;
  } finally {
    // Clean up temporary view
    try {
      await conn.query(`DROP VIEW IF EXISTS "${tempViewName}"`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Map DuckDB type string to DataFrameColumn type.
 * Used when creating column metadata from DESCRIBE query.
 */
function mapDuckDBTypeToDataFrameType(
  duckDBType: string,
): DataFrameColumn["type"] {
  const upper = duckDBType.toUpperCase();

  // Numeric types
  if (
    upper.includes("INT") ||
    upper.includes("DECIMAL") ||
    upper.includes("NUMERIC") ||
    upper.includes("FLOAT") ||
    upper.includes("DOUBLE") ||
    upper.includes("REAL") ||
    upper === "BIGINT" ||
    upper === "HUGEINT" ||
    upper === "SMALLINT" ||
    upper === "TINYINT"
  ) {
    return "number";
  }

  // Date/time types
  if (
    upper.includes("DATE") ||
    upper.includes("TIME") ||
    upper.includes("TIMESTAMP") ||
    upper.includes("INTERVAL")
  ) {
    return "date";
  }

  // Boolean
  if (upper === "BOOLEAN" || upper === "BOOL") {
    return "boolean";
  }

  // Default to string
  return "string";
}
