import { EnhancedDataFrame, Field } from "./index";

// Pattern detection helpers
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

export function analyzeDataFrame(
  df: EnhancedDataFrame,
  fields?: Record<string, Field>,
): ColumnAnalysis[] {
  const rows = df.data.rows;
  const rowCount = rows.length;
  const columns = Object.keys(rows[0] || {});

  return columns.map((columnName) => {
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
    if (category === "unknown") {
      const colName = columnName.toLowerCase();
      const idPatterns = [
        /_id$/, // Ends with _id (user_id, order_id)
        /^id$/, // Exactly "id"
        /^id_/, // Starts with id_
        /^uuid$/, // Exactly "uuid"
        /^guid$/, // Exactly "guid"
      ];
      // Check camelCase: ends with "Id" (capital I) - userId, orderId
      const camelCaseId = /[a-z]Id$/.test(columnName);
      
      if (idPatterns.some((pattern) => pattern.test(colName)) || camelCaseId) {
        category = "identifier";
      } else if (uniqueness > 0.95 && cardinality > 10) {
        // High uniqueness (>95%) with sufficient distinct values is a strong ID indicator
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
          category = "numerical";
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

          // Pattern detection
          let detectedPattern: string | undefined;

          if (stringValues.length > 0) {
            // Check if most values match a pattern
            const emailCount = stringValues.filter(isEmail).length;
            const urlCount = stringValues.filter(isURL).length;
            const uuidCount = stringValues.filter(isUUID).length;

            const threshold = stringValues.length * 0.8; // 80% match threshold

            if (emailCount >= threshold) {
              category = "email";
              detectedPattern = "email";
            } else if (urlCount >= threshold) {
              category = "url";
              detectedPattern = "url";
            } else if (uuidCount >= threshold) {
              category = "uuid";
              detectedPattern = "uuid";
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
