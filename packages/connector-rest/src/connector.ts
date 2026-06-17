/**
 * RestConnector — generic declarative HTTP/JSON connector.
 *
 * Auth-blind: the connector is constructed with a bound SecretResolver
 * pre-bound to the DataSource's credential ref. Data methods (connect, query)
 * carry NO credential arguments — the pipeline call site has no vault, ref,
 * or plaintext in scope (enforced by type).
 *
 * Design contracts:
 * - Config IS the mod: no executable code in config, fully declarative.
 * - authRef resolves via the bound SecretResolver (withSecret scoped lease).
 *   If the endpoint is public (no authRef), pass a no-op resolver or omit.
 * - Unsupported pagination strategies are logged as declarative-ceiling gaps
 *   for the v0.4 code-plugin tier.
 * - Output: Arrow IPC bytes (base64) + fieldIds + fields — serializable over
 *   IPC. The renderer materializes a browser DataFrame from arrowBuffer after
 *   it crosses the IPC boundary.
 */

import type {
  ConnectorQueryResult,
  Field,
  FormField,
  QueryOptions,
  RemoteDatabase,
  SecretResolver,
  UUID,
  ValidationResult,
} from "@dashframe/engine";
import {
  RemoteApiConnector,
  createFieldsFromColumns,
  inferStringColumnType,
} from "@dashframe/engine";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import type { RestConnectorConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Traverse a dot-path in `data` and return the value at that path, or
 * `undefined` if any segment is missing.
 */
function resolveDotPath(data: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = data;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Extract the record array from a parsed JSON response.
 * - No rowPath (or empty): if data is array return it, else return [].
 * - Dot-path: traverse each segment; if resolution fails return [].
 */
export function extractRows(data: unknown, rowPath?: string): unknown[] {
  if (!rowPath) {
    return Array.isArray(data) ? data : [];
  }
  const resolved = resolveDotPath(data, rowPath);
  return Array.isArray(resolved) ? resolved : [];
}

/**
 * Rename keys in a row according to fieldMap. Unmapped keys pass through.
 */
export function applyFieldMap(
  row: Record<string, unknown>,
  fieldMap?: Record<string, string>,
): Record<string, unknown> {
  if (!fieldMap) return row;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const mappedKey = fieldMap[key] ?? key;
    result[mappedKey] = value;
  }
  return result;
}

/**
 * Collect all column names from all rows, infer each column's type from the
 * first non-null value, and return Field[] via createFieldsFromColumns.
 */
export function inferFieldsFromRows(
  rows: Record<string, unknown>[],
  tableId: UUID,
): Field[] {
  // Collect all column names
  const columnNames = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnNames.add(key);
    }
  }

  // For each column, find first non-null value and infer type
  const columns = [...columnNames].map((name) => {
    let type: ReturnType<typeof inferStringColumnType> = "unknown";
    for (const row of rows) {
      const v = row[name];
      if (v !== null && v !== undefined) {
        type = inferStringColumnType(String(v));
        break;
      }
    }
    return { name, type };
  });

  return createFieldsFromColumns(columns, tableId);
}

/**
 * Build a URL by appending (or replacing) a query parameter.
 */
function withQueryParam(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

/**
 * Perform a single HTTP request. Throws on non-ok status.
 */
async function fetchPage(
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ data: unknown; response: Response }> {
  const response = await fetch(url, { method, headers });
  if (!response.ok) {
    throw new Error(
      `[RestConnector] HTTP ${response.status} ${response.statusText} — ${url}`,
    );
  }
  const data: unknown = await response.json();
  return { data, response };
}

/**
 * Fetch all pages according to the configured pagination strategy.
 * Returns a flat array of all raw row objects across pages.
 *
 * @param config  - Connector config (endpoint, pagination, etc.)
 * @param headers - Pre-resolved request headers (auth already injected)
 */
async function fetchAllPages(
  config: RestConnectorConfig,
  headers: Record<string, string>,
): Promise<unknown[]> {
  const method = config.method ?? "GET";
  const pp = config.paginationParams ?? {};
  const allRows: unknown[] = [];

  switch (config.pagination) {
    case "offset": {
      const pageSize = (pp["pageSize"] as number | undefined) ?? 100;
      const offsetParam = (pp["offsetParam"] as string | undefined) ?? "offset";
      const limitParam = (pp["limitParam"] as string | undefined) ?? "limit";
      let offset = 0;

      while (true) {
        const url = withQueryParam(
          withQueryParam(config.endpoint, offsetParam, String(offset)),
          limitParam,
          String(pageSize),
        );
        const { data } = await fetchPage(url, method, headers);
        const rows = extractRows(data, config.rowPath);
        allRows.push(...rows);
        if (rows.length === 0 || rows.length < pageSize) break;
        offset += pageSize;
      }
      break;
    }

    case "page-number": {
      const pageSize = (pp["pageSize"] as number | undefined) ?? 100;
      const pageParam = (pp["pageParam"] as string | undefined) ?? "page";
      const pageSizeParam =
        (pp["pageSizeParam"] as string | undefined) ?? "pageSize";
      let page = 1;

      while (true) {
        const url = withQueryParam(
          withQueryParam(config.endpoint, pageParam, String(page)),
          pageSizeParam,
          String(pageSize),
        );
        const { data } = await fetchPage(url, method, headers);
        const rows = extractRows(data, config.rowPath);
        allRows.push(...rows);
        if (rows.length === 0 || rows.length < pageSize) break;
        page++;
      }
      break;
    }

    case "cursor": {
      const cursorParam = (pp["cursorParam"] as string | undefined) ?? "cursor";
      const cursorPath = pp["cursorPath"] as string | undefined;
      // Common cursor field names to probe when no explicit path is given
      const defaultCursorFields = [
        "next_cursor",
        "nextCursor",
        "cursor",
        "next",
      ];
      let cursor: string | undefined = undefined;

      while (true) {
        const url = cursor
          ? withQueryParam(config.endpoint, cursorParam, cursor)
          : config.endpoint;
        const { data } = await fetchPage(url, method, headers);
        const rows = extractRows(data, config.rowPath);
        allRows.push(...rows);

        // Find the next cursor
        let nextCursor: unknown = undefined;
        if (cursorPath) {
          nextCursor = resolveDotPath(data, cursorPath);
        } else {
          for (const field of defaultCursorFields) {
            nextCursor = resolveDotPath(data, field);
            if (nextCursor !== undefined && nextCursor !== null) break;
          }
        }

        if (!nextCursor || typeof nextCursor !== "string") break;
        cursor = nextCursor;
      }
      break;
    }

    case "link-header": {
      let nextUrl: string | undefined = config.endpoint;

      while (nextUrl) {
        const { data, response } = await fetchPage(nextUrl, method, headers);
        const rows = extractRows(data, config.rowPath);
        allRows.push(...rows);

        // Parse Link header: <url>; rel="next"
        const linkHeader = response.headers.get("Link");
        nextUrl = undefined;
        if (linkHeader) {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (match?.[1]) {
            nextUrl = match[1];
          }
        }
      }
      break;
    }

    default: {
      if (config.pagination) {
        console.warn(
          `[RestConnector] Unsupported pagination strategy "${config.pagination}". ` +
            "Falling back to single-page fetch. " +
            "This is a declarative-ceiling gap — implement via the v0.4 code-plugin tier.",
        );
      }
      const { data } = await fetchPage(config.endpoint, method, headers);
      allRows.push(...extractRows(data, config.rowPath));
      break;
    }
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

/**
 * RestConnector — auth-blind, declarative HTTP/JSON connector.
 *
 * Constructed via {@link makeRestConnector} with a bound SecretResolver and
 * declarative config. Use `connect()` and `query()` with no credential
 * arguments — the pipeline call site has no vault, ref, or plaintext in scope.
 */
export class RestConnector extends RemoteApiConnector {
  readonly id = "rest";
  readonly name = "REST API";
  readonly description =
    "Connect to any HTTP/JSON endpoint with declarative pagination.";
  readonly icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

  /** Declarative config — baked in at construction time via factory. */
  readonly #config: RestConnectorConfig;

  constructor(auth: SecretResolver, config: RestConnectorConfig) {
    super(auth);
    this.#config = config;
  }

  getFormFields(): FormField[] {
    return [
      {
        name: "endpoint",
        label: "Endpoint URL",
        type: "text",
        placeholder: "https://api.example.com/data",
        hint: "The HTTP endpoint to fetch data from.",
        required: true,
      },
      {
        name: "method",
        label: "HTTP Method",
        type: "select",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
        ],
        hint: "HTTP method to use (default: GET).",
      },
      {
        name: "authRef",
        label: "Auth Secret Ref",
        type: "text",
        placeholder: "secret:<uuid>",
        hint: "A SecretRef pointing to the Bearer token in the vault. Never a plaintext credential.",
      },
      {
        name: "pagination",
        label: "Pagination Strategy",
        type: "select",
        options: [
          { value: "", label: "None (single page)" },
          { value: "offset", label: "Offset / Limit" },
          { value: "page-number", label: "Page Number" },
          { value: "cursor", label: "Cursor" },
          { value: "link-header", label: "Link Header (RFC 5988)" },
        ],
        hint: "How to paginate through results.",
      },
      {
        name: "rowPath",
        label: "Row Path",
        type: "text",
        placeholder: "data.items",
        hint: "Dot-path to the record array in the response. Leave empty if the root is an array.",
      },
    ];
  }

  validate(formData: Record<string, unknown>): ValidationResult {
    const endpoint = formData["endpoint"] as string | undefined;
    if (!endpoint) {
      return {
        valid: false,
        errors: { endpoint: "Endpoint URL is required." },
      };
    }

    try {
      new URL(endpoint);
    } catch {
      return {
        valid: false,
        errors: { endpoint: "Endpoint must be a valid URL." },
      };
    }

    return { valid: true };
  }

  /**
   * Test the connection by fetching the first page of data.
   * Returns the endpoint as a single RemoteDatabase entry on success.
   *
   * NOTE: This is a real network call — it cannot ride a preview transaction.
   * Credentials are resolved via `this.auth` — no credential argument.
   */
  async connect(): Promise<RemoteDatabase[]> {
    return this.auth(async (token) => {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const method = this.#config.method ?? "GET";
      await fetchPage(this.#config.endpoint, method, headers);
      return [
        {
          id: this.#config.endpoint,
          name: this.#config.endpoint,
        },
      ];
    });
  }

  /**
   * Fetch all pages from the REST endpoint and return a serializable result.
   *
   * Returns Arrow IPC bytes (base64) + fieldIds + fields — NOT a live DataFrame.
   * The renderer materializes the browser DataFrame from arrowBuffer after it
   * crosses the IPC boundary.
   *
   * Credentials are resolved via `this.auth` — no credential argument.
   */
  async query(
    _databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult> {
    return this.auth(async (token) => {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Fetch all pages
      const rawRows = await fetchAllPages(this.#config, headers);

      // Apply fieldMap to each row
      const rows = rawRows
        .filter(
          (r): r is Record<string, unknown> =>
            r !== null && typeof r === "object",
        )
        .map((r) => applyFieldMap(r, this.#config.fieldMap));

      // Apply pagination options to limit rows returned
      const limitedRows =
        options?.pagination?.limit !== undefined
          ? rows.slice(
              options.pagination.offset ?? 0,
              (options.pagination.offset ?? 0) + options.pagination.limit,
            )
          : rows;

      // Infer fields
      const fields = inferFieldsFromRows(limitedRows, tableId);

      // Build Arrow table
      const columnNames = fields.map((f) => f.columnName ?? f.name);
      const columnArrays: Record<string, unknown[]> = {};
      for (const colName of columnNames) {
        columnArrays[colName] = limitedRows.map((r) => r[colName] ?? null);
      }

      const arrowTable = tableFromArrays(columnArrays);
      const ipcBuffer = tableToIPC(arrowTable);

      // Base64-encode the IPC buffer for JSON transport
      const base64 = Buffer.from(ipcBuffer).toString("base64");

      return {
        arrowBuffer: base64,
        fieldIds: fields.map((f) => f.id),
        fields,
      };
    });
  }
}

/**
 * A no-op SecretResolver for public endpoints that require no authentication.
 * Passes an empty string as the token — the connector ignores it.
 */
export const noopResolver: SecretResolver = async (use) => use("");

/**
 * Factory — mint a RestConnector bound to the given SecretResolver and config.
 *
 * This is the single construction site for RestConnector. The server-layer
 * connector factory calls this after minting the bound resolver from
 * `vault.withSecret.bind(vault, ref)`.
 *
 * For public endpoints (no authRef), pass {@link noopResolver}.
 *
 * @param auth   - SecretResolver pre-bound to this DataSource's credential ref
 * @param config - Declarative REST config (endpoint, pagination, rowPath, etc.)
 */
export function makeRestConnector(
  auth: SecretResolver,
  config: RestConnectorConfig,
): RestConnector {
  return new RestConnector(auth, config);
}
