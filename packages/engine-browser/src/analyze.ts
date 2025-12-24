import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrameColumn, Field } from "@dashframe/engine";
import { Insight } from "./insight";

// Pattern detection helpers
// eslint-disable-next-line sonarjs/slow-regex -- Email validation pattern, input is bounded
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/.+/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isEmail = (value: string): boolean => EMAIL_PATTERN.test(value);
const isURL = (value: string): boolean => URL_PATTERN.test(value);
const isUUID = (value: string): boolean => UUID_PATTERN.test(value);

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

export type ColumnAnalysis = {
  columnName: string;
  category: ColumnCategory;
  cardinality: number;
  uniqueness: number; // 0 to 1
  nullCount: number;
  sampleValues: unknown[];
  pattern?: string; // Detected pattern if applicable
  min?: number;
  max?: number;
  stdDev?: number;
  zeroCount?: number;
  /** Ratio of the most frequent value (0-1). High value = dominated by one category */
  maxFrequencyRatio?: number;
  /** Min timestamp (ms since epoch) for temporal columns - used for date transform auto-selection */
  minDate?: number;
  /** Max timestamp (ms since epoch) for temporal columns - used for date transform auto-selection */
  maxDate?: number;
};

// ============================================================================
// Cardinality Thresholds - Single source of truth for all consumers
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
// Identifier Detection - Consolidated from axis-warnings.ts
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
 * Consolidated from axis-warnings.ts for single source of truth.
 *
 * @param name - Column name to check
 * @returns true if the column name matches identifier patterns
 */
export function looksLikeIdentifier(name: string): boolean {
  if (NOT_ID_PATTERNS.some((p) => p.test(name))) return false;
  return ID_NAME_PATTERNS.some((p) => p.test(name));
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
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex analysis logic with multiple heuristics
  const analyses: ColumnAnalysis[] = statsRows.map((stats) => {
    const columnName = stats.column_name;
    const sampleValues = samplesByColumn.get(columnName) ?? [];

    try {
      const cardinality = Number(stats.cardinality);
      const nullCount = Number(stats.null_count);
      const dataType = stats.data_type || "unknown";
      const nonNullCount = rowCount - nullCount;
      const uniqueness = nonNullCount > 0 ? cardinality / nonNullCount : 0;

      const min = stats.min_val ?? undefined;
      const max = stats.max_val ?? undefined;
      const stdDev = stats.std_dev ?? undefined;
      const zeroCount = Number(stats.zero_count);

      // Determine category
      let category: ColumnCategory = "unknown";

      // 1. Check explicit field metadata
      if (fields?.[columnName]) {
        const field = fields[columnName];
        if (field.isIdentifier) category = "identifier";
        else if (field.isReference) category = "reference";
      }

      // 2. Pattern-based ID detection
      if (category === "unknown") {
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

        const stringValues = sampleValues
          .map((v) => String(v))
          .filter((v) => v.length > 0);
        const uuidCount = stringValues.filter(isUUID).length;
        const isLikelyUUID =
          stringValues.length > 0 && uuidCount >= stringValues.length * 0.8;

        if (
          !isLikelyUUID &&
          (idPatterns.some((p) => p.test(colName)) ||
            camelCaseId ||
            (uniqueness > 0.95 && cardinality > 10))
        ) {
          category = "identifier";
        }
      }

      // 3. Type-based heuristics using DuckDB data type
      if (category === "unknown") {
        const duckDBType = dataType.toLowerCase();

        if (duckDBType === "boolean" || duckDBType === "bool") {
          category = "boolean";
        } else if (
          duckDBType.includes("int") ||
          duckDBType.includes("float") ||
          duckDBType.includes("double") ||
          duckDBType.includes("decimal") ||
          duckDBType.includes("numeric") ||
          duckDBType.includes("bigint")
        ) {
          // Check if numeric column looks like an ID
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

          if (
            numericIdPatterns.some((p) => p.test(colName)) &&
            !notIdPatterns.some((p) => p.test(colName))
          ) {
            category = "identifier";
          } else {
            category = "numerical";
          }
        } else if (
          duckDBType.includes("date") ||
          duckDBType.includes("time") ||
          duckDBType.includes("timestamp")
        ) {
          category = "temporal";
        } else if (
          duckDBType.includes("varchar") ||
          duckDBType.includes("string") ||
          duckDBType.includes("text")
        ) {
          const stringValues = sampleValues
            .map((v) => String(v))
            .filter((v) => v.length > 0);

          if (stringValues.length > 0) {
            const emailCount = stringValues.filter(isEmail).length;
            const urlCount = stringValues.filter(isURL).length;
            const uuidCount = stringValues.filter(isUUID).length;
            const threshold = stringValues.length * 0.8;

            if (emailCount >= threshold) {
              category = "email";
            } else if (urlCount >= threshold) {
              category = "url";
            } else if (uuidCount >= threshold) {
              category = "uuid";
            } else if (uniqueness === 1 && rowCount > 1) {
              category = "identifier";
            } else if (cardinality < rowCount * 0.2 || cardinality < 50) {
              category = "categorical";
            } else {
              category = "text";
            }
          }
        }
      }

      // Compute max frequency ratio (what % of rows have the most common value)
      const maxFreq = maxFreqByColumn.get(columnName) ?? 0;
      const maxFrequencyRatio = rowCount > 0 ? maxFreq / rowCount : undefined;

      // Extract temporal date range for temporal columns (used for auto-selecting date transforms)
      const minDate =
        category === "temporal" && stats.min_date != null
          ? Number(stats.min_date)
          : undefined;
      const maxDate =
        category === "temporal" && stats.max_date != null
          ? Number(stats.max_date)
          : undefined;

      return {
        columnName,
        category,
        cardinality,
        uniqueness,
        nullCount,
        sampleValues: sampleValues.slice(0, 5),
        ...(category === "email" || category === "url" || category === "uuid"
          ? { pattern: category }
          : {}),
        min,
        max,
        stdDev,
        zeroCount,
        maxFrequencyRatio,
        minDate,
        maxDate,
      };
    } catch (error) {
      console.warn(
        `[analyzeDataFrame] Error analyzing column ${columnName}:`,
        error,
      );
      return {
        columnName,
        category: "unknown" as ColumnCategory,
        cardinality: 0,
        uniqueness: 0,
        nullCount: 0,
        sampleValues: [],
      };
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex join matching with multiple strategies
export function suggestJoinColumns(
  leftAnalysis: ColumnAnalysis[],
  rightAnalysis: ColumnAnalysis[],
  leftTableName?: string,
  rightTableName?: string,
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];

  // Filter out internal/auto-generated columns that shouldn't be used for joins
  const isInternalColumn = (name: string): boolean => {
    const lower = name.toLowerCase();
    return (
      lower.startsWith("_") || // Internal columns like _rowIndex
      lower === "rowindex" ||
      lower === "row_index"
    );
  };

  // Filter analyses to exclude internal columns
  const filteredLeftAnalysis = leftAnalysis.filter(
    (col) => !isInternalColumn(col.columnName),
  );
  const filteredRightAnalysis = rightAnalysis.filter(
    (col) => !isInternalColumn(col.columnName),
  );

  // Helper to check if types are compatible for joining
  const typesCompatible = (
    left: ColumnCategory,
    right: ColumnCategory,
  ): boolean => {
    // Identifiers and references are always compatible
    if (
      (left === "identifier" || left === "reference") &&
      (right === "identifier" || right === "reference")
    ) {
      return true;
    }
    // Same category is compatible
    if (left === right) return true;
    // Numerical can join with identifier (foreign keys are often numeric)
    if (
      (left === "numerical" && right === "identifier") ||
      (left === "identifier" && right === "numerical")
    ) {
      return true;
    }
    return false;
  };

  // Helper to normalize column name for matching
  const normalizeName = (name: string): string => {
    return name.toLowerCase().replace(/[_-]/g, "");
  };

  // Helper to extract base name from foreign key pattern (user_id → user)
  const extractBaseName = (name: string): string | null => {
    const lower = name.toLowerCase();
    // Match patterns like user_id, userId, user-id
    const match = lower.match(/^(.+?)[-_]?id$/i);
    return match ? match[1].replace(/[-_]/g, "") : null;
  };

  // Strategy 1: Exact name match on identifier/reference columns
  for (const leftCol of filteredLeftAnalysis) {
    if (leftCol.category !== "identifier" && leftCol.category !== "reference")
      continue;

    for (const rightCol of filteredRightAnalysis) {
      if (
        rightCol.category !== "identifier" &&
        rightCol.category !== "reference"
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

  // Strategy 2: Reference pattern matching (users.id → orders.user_id)
  // Look for left table's "id" column matching right table's "*_id" foreign key
  const leftIdCol = filteredLeftAnalysis.find(
    (col) =>
      col.columnName.toLowerCase() === "id" &&
      (col.category === "identifier" || col.category === "reference"),
  );

  if (leftIdCol && leftTableName) {
    const tableBaseName = normalizeName(leftTableName.replace(/s$/, "")); // "users" → "user"

    for (const rightCol of filteredRightAnalysis) {
      const fkBaseName = extractBaseName(rightCol.columnName);
      if (fkBaseName && fkBaseName === tableBaseName) {
        // Avoid duplicate suggestions
        const alreadySuggested = suggestions.some(
          (s) =>
            s.leftColumn === leftIdCol.columnName &&
            s.rightColumn === rightCol.columnName,
        );
        if (!alreadySuggested) {
          suggestions.push({
            leftColumn: leftIdCol.columnName,
            rightColumn: rightCol.columnName,
            confidence: "high",
            reason: `Foreign key pattern: ${leftTableName}.id → ${rightCol.columnName}`,
          });
        }
      }
    }
  }

  // Strategy 2b: Reverse reference pattern (orders.user_id → users.id)
  // Look for left table's "*_id" foreign key matching right table's "id" column
  const rightIdCol = filteredRightAnalysis.find(
    (col) =>
      col.columnName.toLowerCase() === "id" &&
      (col.category === "identifier" || col.category === "reference"),
  );

  if (rightIdCol && rightTableName) {
    const tableBaseName = normalizeName(rightTableName.replace(/s$/, "")); // "users" → "user"

    for (const leftCol of filteredLeftAnalysis) {
      const fkBaseName = extractBaseName(leftCol.columnName);
      if (fkBaseName && fkBaseName === tableBaseName) {
        // Avoid duplicate suggestions
        const alreadySuggested = suggestions.some(
          (s) =>
            s.leftColumn === leftCol.columnName &&
            s.rightColumn === rightIdCol.columnName,
        );
        if (!alreadySuggested) {
          suggestions.push({
            leftColumn: leftCol.columnName,
            rightColumn: rightIdCol.columnName,
            confidence: "high",
            reason: `Foreign key pattern: ${leftCol.columnName} → ${rightTableName}.id`,
          });
        }
      }
    }
  }

  // Strategy 3: Same name with compatible types (non-ID columns)
  for (const leftCol of filteredLeftAnalysis) {
    // Skip if already found as ID match
    if (suggestions.some((s) => s.leftColumn === leftCol.columnName)) continue;

    for (const rightCol of filteredRightAnalysis) {
      // Skip if already suggested
      if (suggestions.some((s) => s.rightColumn === rightCol.columnName))
        continue;

      if (
        normalizeName(leftCol.columnName) ===
          normalizeName(rightCol.columnName) &&
        typesCompatible(leftCol.category, rightCol.category)
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

  // Strategy 4: ID pattern matching (look for *_id in right that might match left identifiers)
  for (const rightCol of filteredRightAnalysis) {
    // Skip if already suggested
    if (suggestions.some((s) => s.rightColumn === rightCol.columnName))
      continue;

    const fkBaseName = extractBaseName(rightCol.columnName);
    if (!fkBaseName) continue;

    // Look for matching identifier in left table
    for (const leftCol of filteredLeftAnalysis) {
      if (suggestions.some((s) => s.leftColumn === leftCol.columnName))
        continue;
      if (leftCol.category !== "identifier") continue;

      const leftBaseName =
        extractBaseName(leftCol.columnName) ||
        normalizeName(leftCol.columnName);
      if (
        leftBaseName === fkBaseName ||
        normalizeName(leftCol.columnName) === fkBaseName
      ) {
        suggestions.push({
          leftColumn: leftCol.columnName,
          rightColumn: rightCol.columnName,
          confidence: "low",
          reason: `Potential foreign key: ${leftCol.columnName} → ${rightCol.columnName}`,
        });
      }
    }
  }

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
