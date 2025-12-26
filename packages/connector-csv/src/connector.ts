/**
 * CSV Connector - File source connector for CSV uploads
 *
 * This connector handles CSV file parsing and conversion to DataFrame.
 * It's fully self-contained - all CSV logic stays in this package.
 */

import {
  FileSourceConnector,
  type FormField,
  type FileParseResult,
  type ValidationResult,
  type UUID,
} from "@dashframe/engine-browser";
import { csvToDataFrame } from "./index";

/**
 * Simple CSV parser that handles common CSV formats.
 * Handles quoted fields, escaped quotes, and various line endings.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- State machine parser inherently complex; extracting helpers would hurt readability
function parseCSV(text: string): string[][] {
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

/**
 * CSVConnector - Handles CSV file uploads and parsing.
 *
 * @example
 * ```typescript
 * import { csvConnector } from '@dashframe/csv';
 *
 * // In a React component
 * const result = await csvConnector.parse(file, tableId);
 * ```
 */
export class CSVConnector extends FileSourceConnector {
  readonly id = "csv";
  readonly name = "CSV File";
  readonly description = "Upload a CSV file with headers in the first row.";
  readonly icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>`;
  readonly accept = ".csv,text/csv";
  readonly maxSizeMB = 100;
  readonly helperText = "Supports .csv files up to 100MB (stored locally)";

  getFormFields(): FormField[] {
    // CSV has no configuration options
    return [];
  }

  validate(): ValidationResult {
    // File validation happens on select (accept attribute handles type)
    return { valid: true };
  }

  async parse(file: File, tableId: UUID): Promise<FileParseResult> {
    if (this.maxSizeMB && file.size > this.maxSizeMB * 1024 * 1024) {
      throw new Error(`File size exceeds ${this.maxSizeMB}MB limit.`);
    }

    // Read file as text
    const text = await file.text();

    // Parse CSV into 2D array
    const data = parseCSV(text);

    if (data.length === 0) {
      throw new Error("CSV file is empty");
    }

    if (data.length === 1) {
      throw new Error("CSV file has no data rows (only headers found)");
    }

    // Use existing conversion function
    return csvToDataFrame(data, tableId);
  }
}

/**
 * Singleton instance of the CSV connector.
 * Use this in the web app's connector registry.
 */
export const csvConnector = new CSVConnector();
