/**
 * Pagination strategies for RestConnector.
 *
 * Strategies beyond these four are declarative-ceiling gaps — log a warning
 * and fall back to single-page. The code-plugin tier (v0.4) will handle
 * arbitrary programmatic pagination.
 */
export type PaginationStrategy =
  | "offset"
  | "cursor"
  | "page-number"
  | "link-header";

/**
 * Declarative config interpreted by RestConnector.
 * Config IS the mod — no executable code in config.
 */
export interface RestConnectorConfig {
  /** HTTP endpoint URL */
  endpoint: string;
  /** HTTP method, default GET */
  method?: "GET" | "POST" | "PUT" | "PATCH";
  /**
   * authRef: a SecretRef resolved server-side via the vault.
   * NEVER a plaintext credential.
   */
  authRef?: string;
  /**
   * Pagination strategy. Unsupported patterns are logged as declarative-ceiling
   * gaps for the v0.4 code-plugin tier.
   */
  pagination?: PaginationStrategy;
  /**
   * JSON path to the record array in the response.
   * Dot-separated, e.g. "data.items". Empty string or absent = root array.
   */
  rowPath?: string;
  /**
   * Map response keys to field names: { responseKey: fieldName }.
   * Absent = pass through all keys as-is.
   */
  fieldMap?: Record<string, string>;
  /**
   * Pagination-strategy-specific params.
   *
   * offset / page-number:
   *   pageSize?    — rows per page (default 100)
   *   offsetParam? — query param name for offset (default "offset")
   *   limitParam?  — query param name for limit (default "limit")
   *   pageParam?   — query param name for page number (default "page")
   *   pageSizeParam? — query param name for page size (default "pageSize")
   *
   * cursor:
   *   cursorParam? — query param name to pass the cursor (default "cursor")
   *   cursorPath?  — dot-path in the response body where the next cursor lives
   *                  (default: tries "next_cursor", "nextCursor", "cursor", "next")
   *
   * link-header: (no additional params)
   */
  paginationParams?: Record<string, unknown>;
}
