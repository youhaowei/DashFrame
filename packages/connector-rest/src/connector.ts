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
  ColumnType,
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
  parsePrimitiveValueByType,
  parseStringValueByType,
} from "@dashframe/engine";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { isPrivateHost } from "./private-host.js";
import type { RestConnectorConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * SSRF sink-guard for a fetch URL: throw unless the URL parses and its host is
 * public. Shared by the fetch sink (`fetchPage`) and surfaced through
 * `validate()` for the config form. Guard the sink, not the provenance — every
 * fetch inherits this regardless of how the endpoint was authored.
 */
function assertPublicUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[RestConnector] Invalid URL: ${url}`);
  }
  if (isPrivateHost(host)) {
    throw new Error(
      `[RestConnector] Endpoint host "${host}" is private/internal — ` +
        "refusing to fetch (SSRF guard).",
    );
  }
}

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
 * Validate a fieldMap for target-name collisions BEFORE any row is mapped.
 *
 * Two collision classes corrupt the result silently if allowed through:
 *  - two distinct source keys map to the SAME target (one value clobbers the
 *    other based on iteration order), and
 *  - a source key maps onto a target that is ALSO an un-mapped passthrough key
 *    present in the data (e.g. `{ full_name: "name" }` against a row that also
 *    has its own `name`).
 *
 * The second class cannot be detected from the fieldMap alone (it depends on
 * the response keys), so it is checked per-row in {@link applyFieldMap}. This
 * function catches the map-internal collision (two sources → one target) up
 * front, which is config-static.
 *
 * @throws if two source keys map to the same target name.
 */
export function assertFieldMapNoCollision(
  fieldMap: Record<string, string>,
): void {
  const targets = new Map<string, string>(); // target → source that claimed it
  for (const [source, target] of Object.entries(fieldMap)) {
    const prior = targets.get(target);
    if (prior !== undefined) {
      throw new Error(
        `[RestConnector] fieldMap collision: both "${prior}" and "${source}" ` +
          `map to target field "${target}". Targets must be unique.`,
      );
    }
    targets.set(target, source);
  }
}

/**
 * Keys that must never become column names. They corrupt `apache-arrow`'s
 * column iteration: verified against apache-arrow 21.1.0, a `__proto__` column
 * does NOT throw — it silently makes Arrow drop the sibling real columns from
 * the built table. `constructor`/`prototype` pass through but are never
 * legitimate column names. A REST source cannot have a legitimate data column
 * named any of these, so they are dropped from every row before
 * inference/serialization — fail-safe, not fail-loud.
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Rename keys in a row according to fieldMap, dropping prototype-polluting keys.
 *
 * - Drops `__proto__`/`constructor`/`prototype` source keys (see
 *   {@link DANGEROUS_KEYS}) — they cannot be valid columns and would corrupt the
 *   Arrow build. Always applied, even with no fieldMap.
 * - Output is a null-prototype object so no key can mutate a prototype.
 * - Rejects a collision where a renamed key lands on a key already produced for
 *   this row (another rename, or an un-mapped passthrough key). A silent
 *   overwrite would drop one of the two source values before schema inference,
 *   so the connector fails loudly instead.
 *
 * @throws if a mapped target collides with an existing key in the output row.
 */
export function applyFieldMap(
  row: Record<string, unknown>,
  fieldMap?: Record<string, string>,
): Record<string, unknown> {
  // Null-prototype output so a response key cannot mutate a prototype, and so
  // dropped dangerous keys never reappear via the prototype chain.
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(row)) {
    if (DANGEROUS_KEYS.has(key)) continue; // never a real column
    const mappedKey = fieldMap?.[key] ?? key;
    if (DANGEROUS_KEYS.has(mappedKey)) {
      throw new Error(
        `[RestConnector] fieldMap maps "${key}" onto reserved name "${mappedKey}" — refused.`,
      );
    }
    if (Object.hasOwn(result, mappedKey)) {
      throw new Error(
        `[RestConnector] fieldMap collision: key "${key}" maps to "${mappedKey}", ` +
          `which already exists in the row. Two source fields would collapse into one.`,
      );
    }
    result[mappedKey] = value;
  }
  return result;
}

/**
 * Coerce a single JSON value to match the inferred column type, so the Arrow
 * schema (built from these values) agrees with the inferred `fields` metadata.
 *
 * REST APIs commonly serialize typed values as strings (`"42"`, `"true"`, an
 * ISO date). Field inference (via {@link inferStringColumnType}) marks such a
 * column number/boolean/date, but the raw string flowing into Arrow unchanged
 * would yield a VARCHAR schema — a mismatch that offers numeric/date ops on a
 * string column downstream.
 *
 * Coercion routes by value shape to the engine helper whose contract MATCHES
 * inference, so the two cannot disagree:
 *  - STRING values → {@link parseStringValueByType}. Inference itself runs on
 *    `inferStringColumnType(String(v))`, and this helper shares that string
 *    contract: `"yes"`/`"no"` → boolean, an empty string `""` → `null` (NOT a
 *    fabricated `0`, which `Number("")` would produce).
 *  - native number/boolean values → {@link parsePrimitiveValueByType}, which
 *    keeps an already-typed primitive as-is.
 *  - non-primitive values (nested objects/arrays) → passed through untouched;
 *    inference would have typed such a column `string`/`unknown` and Arrow
 *    serializes the structured value directly.
 */
function coerceValueToType(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    // String path: same contract inference is built on ("" → null, yes/no → bool).
    return parseStringValueByType(value, type);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return parsePrimitiveValueByType(value, type);
  }
  return value;
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
 * Coerce a declarative `pageSize` config value to a positive integer.
 *
 * Declarative JSON config can supply `pageSize` as a string (`"100"`). Without
 * coercion `offset += pageSize` would string-concatenate (`0` → `"0100"` →
 * `"0100100"`), corrupting offset arithmetic and skipping/repeating pages.
 * A missing or invalid value falls back to `fallback`.
 */
function coercePageSize(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Perform a single HTTP request. Throws on non-ok status.
 */
async function fetchPage(
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ data: unknown; response: Response }> {
  // SSRF sink-guard: this is the single fetch choke point — every pagination
  // strategy and connect() route through here. Reject a private/loopback/
  // link-local host BEFORE the request leaves the process, so the guard covers
  // the initial endpoint and every paginated/redirect-resolved URL regardless of
  // who authored the config. Guarding here (the sink) rather than only at form
  // validation means a config persisted by any path — UI form, assistant, direct
  // wire call — cannot reach an internal host.
  assertPublicUrl(url);
  const response = await fetch(url, { method, headers });
  if (!response.ok) {
    throw new Error(
      `[RestConnector] HTTP ${response.status} ${response.statusText} — ${url}`,
    );
  }
  const data: unknown = await response.json();
  return { data, response };
}

// The `budget` arg threaded through pagination is a max-rows count: pagination
// STOPS as soon as enough rows are collected to satisfy `offset + limit`,
// instead of walking the whole remote chain and slicing afterward. `Infinity`
// means "no budget — fetch all".

/** Offset/limit pagination — increments offset by pageSize until a short page. */
async function fetchOffsetPages(
  config: RestConnectorConfig,
  method: string,
  headers: Record<string, string>,
  budget: number,
): Promise<unknown[]> {
  const pp = config.paginationParams ?? {};
  const pageSize = coercePageSize(pp["pageSize"], 100);
  const offsetParam = (pp["offsetParam"] as string | undefined) ?? "offset";
  const limitParam = (pp["limitParam"] as string | undefined) ?? "limit";
  const allRows: unknown[] = [];
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
    if (allRows.length >= budget) break;
    if (rows.length === 0 || rows.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}

/** Page-number pagination — increments page until a short page. */
async function fetchPageNumberPages(
  config: RestConnectorConfig,
  method: string,
  headers: Record<string, string>,
  budget: number,
): Promise<unknown[]> {
  const pp = config.paginationParams ?? {};
  const pageSize = coercePageSize(pp["pageSize"], 100);
  const pageParam = (pp["pageParam"] as string | undefined) ?? "page";
  const pageSizeParam =
    (pp["pageSizeParam"] as string | undefined) ?? "pageSize";
  const allRows: unknown[] = [];
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
    if (allRows.length >= budget) break;
    if (rows.length === 0 || rows.length < pageSize) break;
    page++;
  }

  return allRows;
}

/**
 * Resolve the next cursor from a response object.
 * Checks cursorPath first; falls back to probing common field names.
 */
function resolveNextCursor(
  data: unknown,
  cursorPath: string | undefined,
): string | undefined {
  if (cursorPath) {
    const v = resolveDotPath(data, cursorPath);
    return typeof v === "string" && v ? v : undefined;
  }
  for (const field of ["next_cursor", "nextCursor", "cursor", "next"]) {
    const v = resolveDotPath(data, field);
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Cursor pagination — follows a cursor token until absent. */
async function fetchCursorPages(
  config: RestConnectorConfig,
  method: string,
  headers: Record<string, string>,
  budget: number,
): Promise<unknown[]> {
  const pp = config.paginationParams ?? {};
  const cursorParam = (pp["cursorParam"] as string | undefined) ?? "cursor";
  const cursorPath = pp["cursorPath"] as string | undefined;
  const allRows: unknown[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const url = cursor
      ? withQueryParam(config.endpoint, cursorParam, cursor)
      : config.endpoint;
    const { data } = await fetchPage(url, method, headers);
    allRows.push(...extractRows(data, config.rowPath));
    if (allRows.length >= budget) break;
    cursor = resolveNextCursor(data, cursorPath);
    if (!cursor) break;
  }

  return allRows;
}

/**
 * Split a `Link` header into entries on the commas that separate entries,
 * IGNORING commas inside `<...>` URLs. RFC 5988 angle-brackets the URI-reference
 * precisely so a URL may legally contain a comma (e.g. `?ids=1,2,3`); a naive
 * `split(",")` would break such a URL and silently drop its link. We track
 * bracket depth and only cut at a comma when outside brackets. No quantified
 * regex, so there is no super-linear backtracking.
 */
function splitLinkEntries(linkHeader: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < linkHeader.length; i++) {
    const ch = linkHeader[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      entries.push(linkHeader.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(linkHeader.slice(start));
  return entries;
}

/**
 * Does this entry's parameter section declare `rel="next"` (or bare `rel=next`)?
 * Matches the `next` token exactly — `rel=nextpage` must NOT qualify. RFC 5988
 * rel values are space-separated tokens, so we tokenize the unquoted form.
 */
function relIsNext(params: string): boolean {
  const lower = params.toLowerCase();
  if (lower.includes('rel="next"')) return true;
  // Bare unquoted form: `rel=next` as a whole token (not `rel=nextpage`).
  const m = /rel=([a-z][a-z0-9.\-_]*)/.exec(lower);
  return m?.[1] === "next";
}

/**
 * Parse a `Link` response header and return the `rel="next"` URL, or undefined.
 *
 * RFC 5988 separates entries with a `,` that follows the parameter attributes
 * (e.g. `<u1>; rel="prev", <u2>; rel="next"`), NOT a `,` immediately after `>`.
 * Each entry is `<URL>; param=...; rel="..."`. We split into entries on
 * out-of-bracket commas ({@link splitLinkEntries}), then for each entry pull the
 * angle-bracketed URL and check whether ITS OWN `rel` is `next`
 * ({@link relIsNext}). Confining the `rel` check to a single entry prevents
 * matching a later entry's `rel="next"` against an earlier URL (the
 * prev-before-next bug). `indexOf`/`slice` parsing avoids backtracking.
 */
function parseLinkNext(linkHeader: string): string | undefined {
  for (const entry of splitLinkEntries(linkHeader)) {
    const ltIdx = entry.indexOf("<");
    const gtIdx = entry.indexOf(">", ltIdx + 1);
    if (ltIdx === -1 || gtIdx === -1) continue;
    const url = entry.slice(ltIdx + 1, gtIdx);
    // Only the params AFTER the URL describe this link's rel.
    if (relIsNext(entry.slice(gtIdx + 1))) return url;
  }
  return undefined;
}

/**
 * Resolve a (possibly relative) Link-header URL against the page it came from.
 * APIs may return a relative `next` link (`</data?page=2>; rel="next"`); a bare
 * relative URL would fail `fetch()` in the Node server context. The `URL`
 * constructor with a base resolves both absolute and relative forms.
 */
function resolveLinkUrl(rawUrl: string, baseUrl: string): string | undefined {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * Link-header pagination — follows RFC 5988 `Link: <url>; rel="next"`.
 *
 * SECURITY (SSRF + credential leak): the request `headers` carry the
 * vault-resolved Bearer token. A compromised or malicious API could return a
 * `rel="next"` URL pointing at an attacker/internal host to harvest that token.
 * We therefore forward the credentialed request ONLY to a same-origin next-link
 * — a cross-origin link stops pagination (the token is never sent off-origin).
 */
async function fetchLinkHeaderPages(
  config: RestConnectorConfig,
  method: string,
  headers: Record<string, string>,
  budget: number,
): Promise<unknown[]> {
  const allRows: unknown[] = [];
  const configOrigin = new URL(config.endpoint).origin;
  let nextUrl: string | undefined = config.endpoint;

  while (nextUrl) {
    const currentUrl: string = nextUrl;
    const { data, response } = await fetchPage(currentUrl, method, headers);
    allRows.push(...extractRows(data, config.rowPath));
    if (allRows.length >= budget) return allRows;

    const linkHeader = response.headers.get("Link");
    const rawNext = linkHeader ? parseLinkNext(linkHeader) : undefined;
    // Resolve relative links against the page we just fetched.
    const resolved: string | undefined = rawNext
      ? resolveLinkUrl(rawNext, currentUrl)
      : undefined;
    // Same-origin guard: never forward the credential to a different origin.
    // A cross-origin (or unresolvable) next-link stops pagination so the
    // vault-resolved Bearer token is never sent off-origin.
    if (resolved && new URL(resolved).origin === configOrigin) {
      nextUrl = resolved;
    } else {
      if (resolved) {
        console.warn(
          `[RestConnector] Link rel="next" "${resolved}" is cross-origin ` +
            `(expected ${configOrigin}) — stopping pagination so the credential ` +
            `is not forwarded off-origin.`,
        );
      }
      nextUrl = undefined;
    }
  }

  return allRows;
}

/**
 * Fetch all pages according to the configured pagination strategy.
 * Returns a flat array of all raw row objects across pages.
 *
 * @param config  - Connector config (endpoint, pagination, etc.)
 * @param headers - Pre-resolved request headers (auth already injected)
 * @param budget  - Max rows to collect before stopping (Infinity = all)
 */
async function fetchAllPages(
  config: RestConnectorConfig,
  headers: Record<string, string>,
  budget: number,
): Promise<unknown[]> {
  const method = config.method ?? "GET";

  switch (config.pagination) {
    case "offset":
      return fetchOffsetPages(config, method, headers, budget);
    case "page-number":
      return fetchPageNumberPages(config, method, headers, budget);
    case "cursor":
      return fetchCursorPages(config, method, headers, budget);
    case "link-header":
      return fetchLinkHeaderPages(config, method, headers, budget);
    default: {
      if (config.pagination) {
        console.warn(
          `[RestConnector] Unsupported pagination strategy "${config.pagination}". ` +
            "Falling back to single-page fetch. " +
            "This is a declarative-ceiling gap — implement via the v0.4 code-plugin tier.",
        );
      }
      const { data } = await fetchPage(config.endpoint, method, headers);
      return extractRows(data, config.rowPath);
    }
  }
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

  /**
   * Resolve the auth headers, failing CLOSED when a credential is required but
   * absent. The contract: if `config.authRef` is set, this DataSource is an
   * authenticated source — a request MUST carry the credential. If the bound
   * resolver yields an empty token (miswired factory, deleted secret), we throw
   * BEFORE any fetch rather than silently issuing an unauthenticated request
   * (which could read a public fallback as if it were the authed data).
   *
   * When `config.authRef` is absent the source is public: an empty token means
   * "no auth", and we send no Authorization header.
   *
   * @throws if `config.authRef` is set but the resolver yields no token.
   */
  #authHeaders(token: string): Record<string, string> {
    if (this.#config.authRef) {
      if (!token) {
        throw new Error(
          "[RestConnector] authRef is configured but the secret resolver " +
            "returned no token — refusing to issue an unauthenticated request " +
            "(fail-closed).",
        );
      }
      return { Authorization: `Bearer ${token}` };
    }
    // Public source (no authRef): forward a token only if one happens to exist.
    return token ? { Authorization: `Bearer ${token}` } : {};
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

    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      return {
        valid: false,
        errors: { endpoint: "Endpoint must be a valid URL." },
      };
    }

    // SSRF check, form-side: reject endpoints addressing a private, loopback,
    // link-local, or reserved host (RFC-1918, 127/8, 169.254/16 cloud-metadata,
    // ::1, fc00::/7, fe80::/10, 0.0.0.0) so the config form surfaces the error
    // early. This is UX — the AUTHORITATIVE guard is at the fetch sink
    // (`fetchPage` → `assertPublicUrl`), which every fetch routes through
    // regardless of how the endpoint was authored. (DNS-rebinding — a public
    // hostname resolving to a private IP at fetch time — is a separate fetch-time
    // concern; this synchronous check covers literal hosts.)
    if (isPrivateHost(parsed.hostname)) {
      return {
        valid: false,
        errors: {
          endpoint:
            "Endpoint must be a public host — private, loopback, and " +
            "link-local addresses are not allowed.",
        },
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
      const headers = this.#authHeaders(token);
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
    // Reject config-static fieldMap collisions before any network work.
    if (this.#config.fieldMap) {
      assertFieldMapNoCollision(this.#config.fieldMap);
    }

    // Push the requested window into pagination: stop fetching once enough rows
    // are collected to satisfy offset+limit, instead of walking the whole
    // remote chain and slicing afterward (avoids unbounded over-fetch).
    const limit = options?.pagination?.limit;
    const sliceOffset = options?.pagination?.offset ?? 0;
    const budget = limit !== undefined ? sliceOffset + limit : Infinity;

    return this.auth(async (token) => {
      const headers = this.#authHeaders(token);

      // Fetch pages up to the row budget.
      const rawRows = await fetchAllPages(this.#config, headers, budget);

      // Apply fieldMap to each row (rejects per-row target collisions).
      const rows = rawRows
        .filter(
          (r): r is Record<string, unknown> =>
            r !== null && typeof r === "object",
        )
        .map((r) => applyFieldMap(r, this.#config.fieldMap));

      // Apply the requested window after collecting just enough rows.
      const limitedRows =
        limit !== undefined
          ? rows.slice(sliceOffset, sliceOffset + limit)
          : rows;

      // Infer fields
      const fields = inferFieldsFromRows(limitedRows, tableId);

      // Build Arrow table. Use a null-prototype object so a response column
      // named `__proto__`/`constructor` is stored as data, not a prototype
      // mutation (which would silently drop the column from the Arrow table
      // while `fieldIds` still listed it). Coerce each value to the inferred
      // column type so the Arrow schema agrees with the `fields` metadata.
      const columnArrays: Record<string, unknown[]> = Object.create(
        null,
      ) as Record<string, unknown[]>;
      for (const field of fields) {
        const colName = field.columnName ?? field.name;
        columnArrays[colName] = limitedRows.map((r) =>
          coerceValueToType(r[colName] ?? null, field.type),
        );
      }

      const arrowTable = tableFromArrays(columnArrays);
      const ipcBuffer = tableToIPC(arrowTable);

      // Base64-encode the IPC buffer for JSON transport
      const base64 = Buffer.from(ipcBuffer).toString("base64");

      return {
        arrowBuffer: base64,
        fieldIds: fields.map((f) => f.id),
        fields,
        rowCount: limitedRows.length,
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
