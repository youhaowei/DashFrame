/**
 * CSV Parser - Handles CSV text parsing into 2D string arrays.
 *
 * This is a utility function used by connectors to parse CSV file content.
 * Handles quoted fields, escaped quotes, and various line endings.
 */

/**
 * Parse CSV text into a 2D array of strings.
 * Handles quoted fields, escaped quotes, and various line endings (CRLF, LF, CR).
 *
 * @param text - Raw CSV text content
 * @returns 2D array where first row is headers, subsequent rows are data
 *
 * @example
 * ```typescript
 * const text = 'name,age\n"Alice",30\nBob,25';
 * const rows = parseCSV(text);
 * // [['name', 'age'], ['Alice', '30'], ['Bob', '25']]
 * ```
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- State machine parser inherently complex; extracting helpers would hurt readability
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote - add single quote and skip the second quote
          currentField += '"';
          // eslint-disable-next-line sonarjs/updated-loop-counter -- Intentional: skip second quote, then continue skips rest of iteration
          i++;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
      } else if (char === "\r" && nextChar === "\n") {
        // Windows line ending
        currentRow.push(currentField);
        if (currentRow.length > 0 && currentRow.some((f) => f !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        // eslint-disable-next-line sonarjs/updated-loop-counter -- Intentional: skip \n in CRLF line ending
        i++;
      } else if (char === "\n" || char === "\r") {
        // Unix or old Mac line ending
        currentRow.push(currentField);
        if (currentRow.length > 0 && currentRow.some((f) => f !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  // Don't forget the last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}
