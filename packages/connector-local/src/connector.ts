/**
 * Local File Connector - Unified file uploader for local files (CSV, JSON).
 *
 * This connector handles local file uploads and delegates to format-specific
 * parsers based on file extension. It's the single entry point for all local
 * file data sources.
 *
 * Architecture:
 * - connector-local: Handles file upload UI and orchestration
 * - @dashframe/csv: CSV parsing utilities
 * - @dashframe/json: JSON parsing utilities
 */

import { csvToDataFrame, parseCSV } from "@dashframe/csv";
import {
  FileSourceConnector,
  type FileParseResult,
  type FormField,
  type UUID,
  type ValidationResult,
} from "@dashframe/engine-browser";
import { jsonToDataFrame, type JSONData } from "@dashframe/json";

/** Supported file extensions */
const SUPPORTED_EXTENSIONS = ["csv", "json"] as const;
type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * Extract file extension from filename.
 * Returns lowercase extension without the dot.
 */
function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Check if an extension is supported.
 */
function isSupportedExtension(ext: string): ext is SupportedExtension {
  return SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension);
}

/**
 * LocalFileConnector - Unified connector for local file uploads.
 *
 * Handles both CSV and JSON files through a single file input.
 * Automatically detects format by file extension and delegates
 * to the appropriate parser.
 *
 * @example
 * ```typescript
 * import { localFileConnector } from '@dashframe/connector-local';
 *
 * // In connector registry
 * const connectors = [localFileConnector, notionConnector];
 *
 * // Parse a file (works with both CSV and JSON)
 * const result = await localFileConnector.parse(file, tableId);
 * ```
 */
export class LocalFileConnector extends FileSourceConnector {
  readonly id = "local";
  readonly name = "Local Files";
  readonly description = "Upload a CSV or JSON file from your computer.";
  readonly icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3-3 3 3"/></svg>`;
  readonly accept = ".csv,.json,text/csv,application/json";
  readonly maxSizeMB = 100;
  readonly helperText =
    "Supports CSV and JSON files up to 100MB (stored locally)";

  getFormFields(): FormField[] {
    // No additional configuration needed
    return [];
  }

  validate(): ValidationResult {
    // File validation happens on parse
    return { valid: true };
  }

  async parse(file: File, tableId: UUID): Promise<FileParseResult> {
    // Validate file size
    if (this.maxSizeMB && file.size > this.maxSizeMB * 1024 * 1024) {
      throw new Error(`File size exceeds ${this.maxSizeMB}MB limit.`);
    }

    // Detect format by extension
    const extension = getFileExtension(file.name);

    if (!isSupportedExtension(extension)) {
      throw new Error(
        `Unsupported file format: .${extension}. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}`,
      );
    }

    // Read file content
    const text = await file.text();

    // Delegate to format-specific parser
    switch (extension) {
      case "csv":
        return this.parseCSVFile(text, tableId);
      case "json":
        return this.parseJSONFile(text, tableId);
    }
  }

  /**
   * Parse CSV file content.
   */
  private async parseCSVFile(
    text: string,
    tableId: UUID,
  ): Promise<FileParseResult> {
    // Parse CSV text into 2D array
    const data = parseCSV(text);

    if (data.length === 0) {
      throw new Error("CSV file is empty");
    }

    if (data.length === 1) {
      throw new Error("CSV file has no data rows (only headers found)");
    }

    return csvToDataFrame(data, tableId);
  }

  /**
   * Parse JSON file content.
   */
  private async parseJSONFile(
    text: string,
    tableId: UUID,
  ): Promise<FileParseResult> {
    // Parse JSON
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON format: failed to parse file content");
    }

    // Validate JSON structure
    if (jsonData === null || typeof jsonData !== "object") {
      throw new Error(
        "JSON file must contain an array of objects or a single object",
      );
    }

    // Validate array format
    if (Array.isArray(jsonData)) {
      if (jsonData.length === 0) {
        throw new Error("JSON array is empty");
      }

      const firstItem = jsonData[0];
      if (firstItem === null || typeof firstItem !== "object") {
        throw new Error("JSON array must contain objects");
      }
    }

    return jsonToDataFrame(jsonData as JSONData, tableId);
  }
}

/**
 * Singleton instance of the Local File connector.
 * Use this in the web app's connector registry.
 */
export const localFileConnector = new LocalFileConnector();
