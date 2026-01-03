/**
 * JSON Connector - File source connector for JSON uploads
 *
 * This connector handles JSON file parsing and conversion to DataFrame.
 * Supports both array-of-objects and nested JSON structures with automatic flattening.
 */

import {
  FileSourceConnector,
  type FileParseResult,
  type FormField,
  type UUID,
  type ValidationResult,
} from "@dashframe/engine-browser";
import { jsonToDataFrame } from "./index";

/**
 * JSONConnector - Handles JSON file uploads and parsing.
 *
 * Supports two JSON formats:
 * 1. Array of objects: [{"name": "Alice", "age": 30}, ...]
 * 2. Nested objects with automatic dot-notation flattening:
 *    {"user": {"name": "Alice"}} → column: user.name
 *
 * @example
 * ```typescript
 * import { jsonConnector } from '@dashframe/connector-json';
 *
 * // In a React component
 * const result = await jsonConnector.parse(file, tableId);
 * ```
 */
export class JSONConnector extends FileSourceConnector {
  readonly id = "json";
  readonly name = "JSON File";
  readonly description =
    "Upload a JSON file with an array of objects or nested structure.";
  readonly icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l2 2-2 2"/><path d="M16 13l-2 2 2 2"/></svg>`;
  readonly accept = ".json,application/json";
  readonly maxSizeMB = 100;
  readonly helperText =
    "Supports .json files up to 100MB (stored locally). Nested objects are flattened with dot-notation.";

  getFormFields(): FormField[] {
    // JSON has no configuration options
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

    // Parse JSON
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON format: failed to parse file content");
    }

    // Validate JSON structure - must be an array or object
    if (jsonData === null || typeof jsonData !== "object") {
      throw new Error(
        "JSON file must contain an array of objects or a single object",
      );
    }

    // Handle array format
    if (Array.isArray(jsonData)) {
      if (jsonData.length === 0) {
        throw new Error("JSON array is empty");
      }

      // Validate that array contains objects
      const firstItem = jsonData[0];
      if (firstItem === null || typeof firstItem !== "object") {
        throw new Error("JSON array must contain objects");
      }
    }

    // Use existing conversion function
    return jsonToDataFrame(
      jsonData as Parameters<typeof jsonToDataFrame>[0],
      tableId,
    );
  }
}

/**
 * Singleton instance of the JSON connector.
 * Use this in the web app's connector registry.
 */
export const jsonConnector = new JSONConnector();
