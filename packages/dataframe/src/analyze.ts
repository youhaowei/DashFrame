import type { DataFrameRow, DataFrameColumn, Field } from "./index";

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
};

/**
 * Analyze DataFrame rows to categorize columns and detect patterns.
 *
 * @param rows - Array of row data objects
 * @param columns - Array of column definitions (used for column names if provided)
 * @param fields - Optional field metadata for explicit categorization
 * @returns Array of column analysis results
 */
export function analyzeDataFrame(
  rows: DataFrameRow[],
  columns?: DataFrameColumn[],
  fields?: Record<string, Field>,
): ColumnAnalysis[] {
  const rowCount = rows.length;
  // Get column names from columns array if provided, otherwise from first row
  const columnNames = columns
    ? columns.map((col) => col.name)
    : Object.keys(rows[0] || {});

  // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex analysis logic with multiple heuristics
  return columnNames.map((columnName) => {
    const values = rows.map((row) => row[columnName]);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined);
    const nullCount = rowCount - nonNullValues.length;
    const uniqueValues = new Set(nonNullValues.map((v) => String(v)));
    const cardinality = uniqueValues.size;
    const uniqueness =
      nonNullValues.length > 0 ? cardinality / nonNullValues.length : 0;

    let category: ColumnCategory = "unknown";

    // 1. Check explicit field metadata
    if (fields && fields[columnName]) {
      const field = fields[columnName];
      if (field.isIdentifier) {
        category = "identifier";
      } else if (field.isReference) {
        category = "reference";
      }
    }

    // 2. Pattern-based ID detection (before type-based heuristics)
    // This check runs for ALL columns (not just unknown) to catch numeric IDs
    if (category === "unknown" || category === "identifier") {
      const colName = columnName.toLowerCase();
      const idPatterns = [
        /_id$/, // Ends with _id (user_id, order_id)
        /^id$/, // Exactly "id"
        /^id_/, // Starts with id_
        /^uuid$/, // Exactly "uuid"
        /^guid$/, // Exactly "guid"
        /^_rowindex$/, // Internal row index identifier
      ];
      // Check camelCase: ends with "Id" (capital I) - userId, orderId
      const camelCaseId = /[a-z]Id$/.test(columnName);

      // Before marking as identifier, check if the values look like UUIDs
      // UUIDs should be categorized as "uuid", not "identifier"
      const stringValues = nonNullValues
        .map((v) => String(v))
        .filter((v) => v.length > 0);
      const uuidCount = stringValues.filter(isUUID).length;
      const isLikelyUUID =
        stringValues.length > 0 && uuidCount >= stringValues.length * 0.8;

      // High uniqueness (>95%) with sufficient distinct values is also a strong ID indicator
      if (
        !isLikelyUUID &&
        (idPatterns.some((pattern) => pattern.test(colName)) ||
          camelCaseId ||
          (uniqueness > 0.95 && cardinality > 10))
      ) {
        category = "identifier";
      }
    }

    // 3. Heuristics if not explicitly categorized
    if (category === "unknown") {
      if (nonNullValues.length === 0) {
        category = "unknown";
      } else {
        const firstValue = nonNullValues[0];
        const type = typeof firstValue;

        if (type === "boolean") {
          category = "boolean";
        } else if (type === "number") {
          // Check if this numeric column looks like an ID based on name
          const colName = columnName.toLowerCase();
          const numericIdPatterns = [
            /id$/, // Ends with "id" (acctid, userid, orderid)
            /_id$/, // Ends with _id
            /^id$/, // Exactly "id"
            /^id_/, // Starts with id_
            /key$/, // Ends with "key"
            /no$/, // Ends with "no" (orderno)
            /num$/, // Ends with "num"
            /index$/, // Ends with "index"
            /seq$/, // Ends with "seq"
          ];
          const notIdPatterns = [
            /zipcode$/, // Zip codes
            /postcode$/, // Post codes
            /areacode$/, // Area codes
          ];
          if (
            numericIdPatterns.some((pattern) => pattern.test(colName)) &&
            !notIdPatterns.some((pattern) => pattern.test(colName))
          ) {
            category = "identifier";
          } else {
            category = "numerical";
          }
        } else if (
          firstValue instanceof Date ||
          (!isNaN(Date.parse(String(firstValue))) && isNaN(Number(firstValue)))
        ) {
          // Simple date check - can be improved
          category = "temporal";
        } else {
          // String analysis with pattern detection
          const stringValues = nonNullValues
            .map((v) => String(v))
            .filter((v) => v.length > 0);

          if (stringValues.length > 0) {
            // Check if most values match a pattern
            const emailCount = stringValues.filter(isEmail).length;
            const urlCount = stringValues.filter(isURL).length;
            const uuidCount = stringValues.filter(isUUID).length;

            const threshold = stringValues.length * 0.8; // 80% match threshold

            if (emailCount >= threshold) {
              category = "email";
            } else if (urlCount >= threshold) {
              category = "url";
            } else if (uuidCount >= threshold) {
              category = "uuid";
            } else if (uniqueness === 1 && rowCount > 1) {
              // High likelihood of being an identifier if unique
              category = "identifier";
            } else if (cardinality < rowCount * 0.2 || cardinality < 50) {
              // Low cardinality relative to row count -> categorical
              category = "categorical";
            } else {
              category = "text";
            }
          }
        }
      }
    }

    return {
      columnName,
      category,
      cardinality,
      uniqueness,
      nullCount,
      sampleValues: nonNullValues.slice(0, 5),
      ...(category === "email" || category === "url" || category === "uuid"
        ? { pattern: category }
        : {}),
    };
  });
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
