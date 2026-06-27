/**
 * PostgresConnector — read-only Postgres data-source connector.
 *
 * Auth-blind: the connector is constructed with a bound SecretResolver
 * pre-bound to the DataSource's credential ref. Data methods (connect, query)
 * carry NO credential arguments — the pipeline call site has no vault, ref,
 * or plaintext in scope (enforced by type).
 *
 * Security contracts — ALL MANDATORY:
 *
 * 1. Read-only, two layers:
 *    Layer 1 (hard guard): SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY
 *    sets the default transaction mode. In addition, user queries are sent via
 *    the extended query protocol (empty params array) which causes Postgres to
 *    reject multi-statement SQL at the Parse phase — preventing the
 *    `SELECT 1; BEGIN READ WRITE; CREATE TABLE …` bypass.
 *    Layer 2 (fast-fail): A regex allowlist rejects any user-supplied query
 *    whose first non-comment, non-whitespace token is not SELECT/WITH/EXPLAIN/
 *    TABLE — before touching the wire.
 *
 * DEPLOYMENT REQUIREMENT — least-privilege role:
 *    The DSN MUST use a Postgres role that holds only SELECT grants on the
 *    target schemas. The connector cannot enforce this. Using a superuser or
 *    a role with WRITE/DDL grants breaks the read-only guarantee regardless of
 *    the connector's guards — `pg_read_file`, `dblink`, and similar superuser
 *    functions bypass all statement-level controls.
 *
 * 2. Credential never plaintext in config: the DSN is resolved inside
 *    this.auth(async dsn => { ... }). The pg Client is constructed and closed
 *    inside the callback scope; the plaintext DSN never escapes.
 *
 * 3. SQL sink guards:
 *    Sink 1 — connection string assembled only inside auth callback.
 *    Sink 2 — schema/table identifiers quoted via quoteIdentifier(); values
 *             passed as $1/$2 parameters to information_schema queries.
 *    Sink 3 — user query sent with ZERO string interpolation.
 *
 * 4. Fail-closed: if the resolver yields empty, throw before constructing
 *    a client (no unauthenticated connection opened).
 *
 * pg is a Node-only package — all imports are dynamic (inside the auth
 * callback) so this module is safe to import in the renderer for static
 * metadata (id/name/icon/getFormFields) without pulling in Node APIs.
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
  quoteIdentifier,
} from "@dashframe/engine";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import type { PostgresConnectorConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Read-only guard (Layer 2 — fast-fail allowlist)
// ---------------------------------------------------------------------------

/**
 * Strip leading SQL line comments (-- ...) and block comments (/* ... *\/).
 * Iterative — no regex backtracking on arbitrary input.
 */
function stripLeadingComments(sql: string): string {
  let s = sql.trimStart();
  while (true) {
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1).trimStart();
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end === -1) {
        s = "";
      } else {
        s = s.slice(end + 2).trimStart();
      }
    } else {
      break;
    }
  }
  return s;
}

/**
 * Assert that a user-supplied SQL string's first token is an allowlisted
 * read-only keyword: SELECT, WITH, EXPLAIN, or TABLE.
 *
 * The check is Layer 2 (fast-fail at the surface). Layer 1 (SET SESSION
 * CHARACTERISTICS AS TRANSACTION READ ONLY) is the load-bearing guard.
 *
 * @throws if the first token is not on the allowlist.
 */
export function assertReadOnlyQuery(sql: string): void {
  const stripped = stripLeadingComments(sql);
  // Match the first word token, case-insensitive.
  const match = /^([A-Za-z]+)(?:\s|$|;|\()/u.exec(stripped);
  const first = match?.[1]?.toUpperCase() ?? "";
  const allowed = new Set(["SELECT", "WITH", "EXPLAIN", "TABLE"]);
  if (!allowed.has(first)) {
    throw new Error(
      `[PostgresConnector] Non-SELECT query rejected (first token: "${first || "(empty)"}"). ` +
        `Only SELECT / WITH / EXPLAIN / TABLE statements are allowed. ` +
        `This connector is read-only.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Client abstraction (injectable for tests)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for a pg Client used by this connector.
 * Keeps the seam narrow — only the two methods we call are required.
 */
/** Config-object form — used when setting queryMode. */
export interface PgQueryConfig {
  text: string;
  queryMode?: "extended" | "simple";
  values?: unknown[];
}

/** Minimal column descriptor returned by pg in result.fields. */
export interface PgFieldDef {
  name: string;
  dataTypeID: number;
}

/** Result shape returned by query helpers — rows plus column metadata. */
export interface PgQueryResult {
  rows: Record<string, unknown>[];
  /** Column metadata from pg. Present on every successful query, even zero-row results. */
  fields: PgFieldDef[];
}

export interface PgClientLike {
  query(text: string): Promise<PgQueryResult>;
  query(text: string, values: unknown[]): Promise<PgQueryResult>;
  query(config: PgQueryConfig): Promise<PgQueryResult>;
  end(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Introspection helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * List tables and views in the given schema using information_schema.
 *
 * Sink 2 compliance:
 *   - schema name appears as a $1 PARAMETER VALUE in the WHERE clause.
 *   - schema name is also used as an identifier in SET search_path — it is
 *     quoted via quoteIdentifier() before interpolation.
 *   - No user input is ever concatenated raw into SQL text.
 */
export async function listTablesInSchema(
  client: PgClientLike,
  schema: string,
): Promise<string[]> {
  // Set search_path for this session — schema name as a quoted identifier.
  await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);

  // Query information_schema: schema name as a $1 value parameter.
  const result = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY table_name`,
    [schema],
  );

  return result.rows.map((row) => String(row["table_name"] ?? ""));
}

// ---------------------------------------------------------------------------
// Field inference from rows + pg column metadata
// ---------------------------------------------------------------------------

/**
 * Column names that must never reach `apache-arrow`'s `tableFromArrays`: they
 * corrupt Arrow's column iteration. Verified against apache-arrow 21.1.0: a
 * `__proto__` column does NOT throw — it silently makes Arrow drop the sibling
 * real columns from the built table (e.g. `{__proto__:[…], id:[…]}` → schema
 * with zero fields). `constructor`/`prototype` pass through as ordinary columns
 * but are never legitimate data-column names. A Postgres column can technically
 * be named any of these (identifiers are quoted), so all three are dropped
 * before inference and serialization — fail-safe, mirroring the REST
 * connector's DANGEROUS_KEYS.
 */
const DANGEROUS_COLUMN_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Postgres OID → ColumnType.
 *
 * Maps common Postgres OIDs to the ColumnType that agrees with both the JS
 * value node-postgres returns AND how `inferStringColumnType` would classify a
 * sample value from that column. The mapping is critical for two scenarios:
 *
 * 1. **Empty-result schema recovery** — zero-row results have no sample values
 *    to run through value inference, so OID metadata is the only type signal.
 * 2. **Precision-safe coercion** — BIGINT (OID 20) and NUMERIC (OID 1700) are
 *    returned as strings by node-postgres to preserve precision beyond IEEE-754
 *    double. Mapping them to "string" keeps field-type and Arrow value-type in
 *    agreement, and DuckDB casts VARCHAR→BIGINT/NUMERIC during ingest.
 *
 * OIDs not listed here return `undefined` — the caller falls back to
 * value-based inference via `inferStringColumnType`.
 *
 * Agreement table (populated-row path must agree with OID path):
 *   OID 16  bool        → JS boolean   → String("true") → "boolean"  ✓
 *   OID 20  int8/BIGINT → JS string    → already string              ✓ (precision)
 *   OID 21  int2        → JS number    → String(1) → Number ok       "number" ✓
 *   OID 23  int4        → JS number    → String(1) → Number ok       "number" ✓
 *   OID 700 float4      → JS number    → String(1.5) → Number ok     "number" ✓
 *   OID 701 float8      → JS number    → String(1.5) → Number ok     "number" ✓
 *   OID 18  char        → JS string    → OID "string" is stable      ✓
 *   OID 25  text        → JS string    → OID "string" is stable      ✓
 *   OID 1043 varchar    → JS string    → OID "string" is stable      ✓
 *   OID 1082 date       → JS Date      → String(date) parseable      "date"  ✓
 *   OID 1114 timestamp  → JS Date      → String(date) parseable      "date"  ✓
 *   OID 1184 timestamptz→ JS Date      → String(date) parseable      "date"  ✓
 *   OID 1700 NUMERIC    → JS string    → already string              ✓ (precision)
 */
export function pgOidToColumnType(
  dataTypeID: number,
): ReturnType<typeof inferStringColumnType> | undefined {
  switch (dataTypeID) {
    // Boolean
    case 16:
      return "boolean";
    // BIGINT / int8 — returned as string by node-postgres to preserve precision.
    case 20:
      return "string";
    // int2 / smallint
    case 21:
      return "number";
    // int4 / integer
    case 23:
      return "number";
    // float4
    case 700:
      return "number";
    // float8 / double precision
    case 701:
      return "number";
    // "char" — 1-byte internal Postgres type (system catalogs, rarely in user tables)
    case 18:
      return "string";
    // text
    case 25:
      return "string";
    // bpchar / CHAR(n)
    case 1042:
      return "string";
    // varchar
    case 1043:
      return "string";
    // date
    case 1082:
      return "date";
    // timestamp without time zone
    case 1114:
      return "date";
    // timestamp with time zone
    case 1184:
      return "date";
    // NUMERIC / decimal — also returned as string by node-postgres.
    case 1700:
      return "string";
    default:
      return undefined;
  }
}

/**
 * Build a deduplicated column list and OID map from pg column metadata.
 *
 * Deduplication is required: a JOIN with overlapping column names produces
 * duplicate entries in pg's result.fields. Duplicates would let
 * createFieldsFromColumns emit more Fields than Arrow has columns (the
 * columnArrays object deduplicates by key), violating the fieldIds↔arrowBuffer
 * alignment contract. Dangerous column names are excluded from both outputs.
 *
 * Column order: first-occurrence determines position (so column order is stable
 * and consistent with what the query author expects).
 *
 * OID: last-occurrence wins. node-postgres overwrites earlier same-name columns
 * in the row object with the later column's value, so the row value for a
 * duplicate-name column comes from the last occurrence. Using that occurrence's
 * OID ensures field.type and the actual Arrow value are in agreement, even when
 * the two same-name columns have different Postgres types (e.g. int4 + int8 in
 * a cross-type JOIN).
 */
function columnListFromPgFields(pgFields: PgFieldDef[]): {
  columnNames: string[];
  oidByName: Map<string, number>;
} {
  const seenNames = new Set<string>();
  const oidByName = new Map<string, number>();
  for (const f of pgFields) {
    if (DANGEROUS_COLUMN_NAMES.has(f.name)) continue;
    // Track first-occurrence for column-list ordering.
    seenNames.add(f.name);
    // Always overwrite OID — last-occurrence aligns with how pg's row object
    // resolves duplicate names (last value wins).
    oidByName.set(f.name, f.dataTypeID);
  }
  return { columnNames: [...seenNames], oidByName };
}

/**
 * Derive the column name list from the key-union of the given rows.
 * Dangerous column names are excluded.
 */
function columnNamesFromRows(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!DANGEROUS_COLUMN_NAMES.has(key)) seen.add(key);
    }
  }
  return [...seen];
}

/**
 * Infer the ColumnType for a single column.
 *
 * Priority:
 *   1. OID-based type via `pgOidToColumnType` (highest priority — handles
 *      empty-result and precision-sensitive types like BIGINT/NUMERIC).
 *   2. Value-based inference via `inferStringColumnType` on the first non-null
 *      row value (legacy fallback when OID is absent or unmapped).
 */
function inferColumnType(
  name: string,
  oidByName: Map<string, number>,
  rows: Record<string, unknown>[],
): ReturnType<typeof inferStringColumnType> {
  const oid = oidByName.get(name);
  if (oid !== undefined) {
    const oidType = pgOidToColumnType(oid);
    if (oidType !== undefined) return oidType;
  }
  for (const row of rows) {
    const v = row[name];
    if (v !== null && v !== undefined) {
      return inferStringColumnType(String(v));
    }
  }
  return "unknown";
}

/**
 * Infer Field[] from pg query result.
 *
 * Column list source priority:
 *   1. `pgFields` (pg column metadata) — always present, even on zero-row
 *      results. Used as the authoritative column list when available (fixes
 *      empty-result schema loss).
 *   2. Key-union of `rows` — fallback when no metadata is supplied (legacy
 *      call-sites and spy clients that predate this change).
 *
 * Type source priority per column: see `inferColumnType`.
 */
function inferFieldsFromRows(
  rows: Record<string, unknown>[],
  tableId: UUID,
  pgFields?: PgFieldDef[],
): Field[] {
  const hasPgFields = pgFields && pgFields.length > 0;
  const { columnNames, oidByName } = hasPgFields
    ? columnListFromPgFields(pgFields)
    : {
        columnNames: columnNamesFromRows(rows),
        oidByName: new Map<string, number>(),
      };

  const columns = columnNames.map((name) => ({
    name,
    type: inferColumnType(name, oidByName, rows),
  }));

  return createFieldsFromColumns(columns, tableId);
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

/**
 * PostgresConnector — read-only, auth-blind Postgres source connector.
 *
 * Constructed via {@link makePostgresConnector} with a bound SecretResolver
 * and declarative config. Call `connect()` and `query()` with no credential
 * arguments — the pipeline call site has no vault, ref, or plaintext in scope.
 *
 * pg is dynamically imported inside the auth callback to avoid pulling the
 * Node-only `pg` package into the renderer bundle (the renderer imports this
 * module for static metadata only and never calls connect/query).
 */
export class PostgresConnector extends RemoteApiConnector {
  readonly id = "postgres";
  readonly name = "PostgreSQL";
  readonly description = "Connect to a PostgreSQL database (read-only).";
  readonly icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5"/><path d="M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3"/></svg>`;

  readonly #config: PostgresConnectorConfig;

  /**
   * Overridable client factory — enables test subclasses to inject a spy/stub
   * without dynamic-importing the real pg package. The default implementation
   * dynamically imports pg, constructs a Client, and connects it.
   *
   * @param dsn - Plaintext DSN, valid only within the auth callback scope.
   */
  protected async createClient(dsn: string): Promise<PgClientLike> {
    // Dynamic import: keeps pg out of the renderer bundle. The renderer imports
    // this class for static metadata (id/name/icon/getFormFields) and never
    // calls createClient — so pg is never evaluated in a browser context.
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: dsn });
    await client.connect();
    return client as unknown as PgClientLike;
  }

  constructor(auth: SecretResolver, config: PostgresConnectorConfig) {
    super(auth);
    this.#config = config;
  }

  /**
   * Open a read-only pg client scoped to the auth callback.
   *
   * The DSN plaintext is consumed here and NEVER escapes this method.
   * Layer 1 read-only guard is applied first: SET SESSION CHARACTERISTICS AS
   * TRANSACTION READ ONLY is the very first query executed on every connection.
   * If the resolver yields an empty DSN, we throw before constructing the client
   * (fail-closed).
   */
  async #withClient<T>(use: (client: PgClientLike) => Promise<T>): Promise<T> {
    return this.auth(async (dsn) => {
      // Fail-closed: a connectionStringRef implies the credential is required.
      if (!dsn) {
        throw new Error(
          "[PostgresConnector] connectionStringRef is configured but the " +
            "secret resolver returned no DSN — refusing to open a connection " +
            "(fail-closed).",
        );
      }

      // Sink 1: DSN is used only here, inside the auth callback. The client is
      // constructed with the DSN and closed before the callback returns.
      const client = await this.createClient(dsn);

      try {
        // Layer 1 — hard read-only guard. This is the FIRST query on every
        // connection — before any introspection or user query.
        await client.query(
          "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
        );
        // Bound statement execution time. Protects against pg_sleep() and
        // other long-running queries (DoS mitigation — no user-facing timeout).
        await client.query("SET statement_timeout = '30s'");
        return await use(client);
      } finally {
        // Ensure the client is closed even on error — DSN never escapes.
        await client.end().catch(() => {
          // Swallow end() errors: the caller's error takes priority.
        });
      }
    });
  }

  getFormFields(): FormField[] {
    return [
      {
        name: "connectionString",
        label: "Connection String",
        type: "password",
        placeholder: "postgres://user:password@host:5432/dbname",
        hint: "Stored securely in the vault. Never exposed in config.",
        required: true,
      },
      {
        name: "defaultSchema",
        label: "Default Schema",
        type: "text",
        placeholder: "public",
        hint: "Schema to list tables from (default: public).",
      },
    ];
  }

  validate(formData: Record<string, unknown>): ValidationResult {
    const cs = formData["connectionString"] as string | undefined;
    if (!cs) {
      return {
        valid: false,
        errors: { connectionString: "Connection string is required." },
      };
    }
    return { valid: true };
  }

  /**
   * Connect to the Postgres database and list tables/views in the configured
   * schema. Returns one RemoteDatabase entry per table/view.
   *
   * Credentials are resolved via `this.auth` — no credential argument.
   */
  async connect(): Promise<RemoteDatabase[]> {
    const schema = this.#config.defaultSchema ?? "public";
    return this.#withClient(async (client) => {
      const tables = await listTablesInSchema(client, schema);
      return tables.map((table) => ({
        id: `${schema}.${table}`,
        name: table,
      }));
    });
  }

  /**
   * Query the Postgres database and return a serializable Arrow IPC result.
   *
   * `databaseId` is either a fully-qualified table name ("schema.table" from
   * connect()) or a user-supplied SELECT statement. User-supplied SQL is
   * validated by the Layer 2 allowlist before hitting the wire.
   *
   * Returns Arrow IPC bytes (base64) + fieldIds + fields — NOT a live DataFrame.
   * The renderer materializes the browser DataFrame from arrowBuffer after it
   * crosses the IPC boundary.
   *
   * Credentials are resolved via `this.auth` — no credential argument.
   */
  async query(
    databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult> {
    // Determine if databaseId is a "schema.table" reference (from connect())
    // or a raw user SQL statement. This check happens BEFORE auth/client
    // construction: a non-SELECT user query is rejected immediately (Layer 2
    // fast-fail) with zero client.query calls — the error surfaces without
    // touching the wire or the vault.
    // A "schema.table" ref (from connect()) has exactly one dot and no spaces,
    // semicolons, or parentheses — it cannot be a SQL statement.
    // A raw SQL statement always contains at least one space (e.g. "SELECT …").
    const trimmed = databaseId.trim();
    const dotIdx = trimmed.indexOf(".");
    const isTableRef =
      dotIdx > 0 &&
      !trimmed.includes(" ") &&
      !trimmed.includes(";") &&
      !trimmed.includes("(");

    if (!isTableRef) {
      // Layer 2 allowlist — runs BEFORE #withClient (zero network side-effects).
      assertReadOnlyQuery(databaseId);
    }

    const limit = options?.pagination?.limit;
    const offset = options?.pagination?.offset ?? 0;

    // The table-ref path pushes LIMIT/OFFSET into SQL, so it is already
    // windowed by the DB. The user-SQL path is NOT (see below) and is sliced
    // in-process as a backstop. INVARIANT: pushdown and in-process slice are
    // mutually exclusive — exactly one applies a given window, never both.
    const pushedDown = isTableRef && limit !== undefined;

    return this.#withClient(async (client) => {
      let rows: Record<string, unknown>[];
      let pgFields: PgFieldDef[] | undefined;

      if (isTableRef) {
        // Table reference — split on the pre-computed dot index.
        const refSchema = trimmed.slice(0, dotIdx);
        const refTable = trimmed.slice(dotIdx + 1);
        // Sink 2: both parts quoted via quoteIdentifier(). Pagination is pushed
        // down into the SQL (LIMIT/OFFSET) so we never materialize a full table.
        const result = await fetchTable(
          client,
          refSchema,
          refTable,
          limit,
          offset,
        );
        rows = result.rows;
        pgFields = result.fields;
      } else {
        // User-supplied SQL — allowlist already passed above; send with zero
        // interpolation. We deliberately do NOT wrap user SQL to inject
        // LIMIT/OFFSET: wrapping (`SELECT * FROM (<user sql>) ...`) would (1)
        // re-interpolate user text, breaking the Sink 3 zero-interpolation
        // contract, and (2) break legal allowlisted forms like `EXPLAIN …`,
        // `TABLE …`, and trailing-`;` queries. The user authored this query and
        // can bound it; statement_timeout + the post-fetch slice are backstops.
        const result = await runUserQuery(client, databaseId);
        rows = result.rows;
        pgFields = result.fields;
      }

      // Slice only when the window was NOT already pushed into SQL.
      const slicedRows =
        !pushedDown && limit !== undefined
          ? rows.slice(offset, offset + limit)
          : rows;

      // Infer fields from rows + pg column metadata.
      // pgFields is the authoritative column list (handles empty results and
      // OID-based type overrides for NUMERIC/BIGINT precision).
      const fields = inferFieldsFromRows(slicedRows, tableId, pgFields);

      // Build Arrow column arrays from the inferred field set.
      const columnArrays: Record<string, unknown[]> = Object.create(
        null,
      ) as Record<string, unknown[]>;
      for (const field of fields) {
        const colName = field.columnName ?? field.name;
        columnArrays[colName] = slicedRows.map((r) => r[colName] ?? null);
      }

      const arrowTable = tableFromArrays(columnArrays);
      const ipcBuffer = tableToIPC(arrowTable);
      const base64 = Buffer.from(ipcBuffer).toString("base64");

      return {
        arrowBuffer: base64,
        fieldIds: fields.map((f) => f.id),
        fields,
        rowCount: slicedRows.length,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (after class definition to keep the class block clean)
// ---------------------------------------------------------------------------

/**
 * Run a user-supplied SELECT and return rows plus pg column metadata.
 *
 * Sink 3 compliance: the query text is sent as-is, with NO string
 * interpolation of any user value. The text has already passed the allowlist
 * check (Layer 2) and runs on the read-only connection (Layer 1).
 *
 * `queryMode: "extended"` forces node-postgres onto the extended query
 * protocol (Parse → Bind → Execute). Postgres rejects multi-statement SQL
 * during Parse in this protocol, closing the `SELECT 1; BEGIN READ WRITE; …`
 * bypass that would otherwise let an explicit transaction override the
 * session-level read-only default set by SET SESSION CHARACTERISTICS.
 *
 * Note: passing an empty values array `[]` does NOT achieve this — pg checks
 * `values.length > 0` in requiresPreparation(), so `[]` stays on the simple
 * protocol. The `queryMode` field in the config object is the correct opt-in.
 */
async function runUserQuery(
  client: PgClientLike,
  sql: string,
): Promise<PgQueryResult> {
  return client.query({ text: sql, queryMode: "extended" });
}

/**
 * Fetch rows of a named table (schema-qualified), with LIMIT/OFFSET pushed
 * into the SQL when a pagination window is requested.
 *
 * Sink 2 compliance: schema and table are both quoted via quoteIdentifier();
 * limit/offset are bound as `$1`/`$2` parameter VALUES (never interpolated).
 *
 * Pushdown matters because this is the system-generated table-preview path: a
 * preview with `limit: 50` must NOT pull an unbounded table into Node memory
 * and slice afterward. When `limit` is undefined, the plain SELECT is emitted
 * unchanged (full-table behavior preserved for callers that want every row).
 *
 * Returns rows plus pg column metadata (result.fields) for OID-based type
 * inference and zero-row schema recovery.
 */
async function fetchTable(
  client: PgClientLike,
  schema: string,
  table: string,
  limit?: number,
  offset = 0,
): Promise<PgQueryResult> {
  const base = `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  if (limit === undefined) {
    return client.query(base);
  }
  // Bound window: limit/offset as $1/$2 value parameters → extended protocol.
  return client.query(`${base} LIMIT $1 OFFSET $2`, [limit, offset]);
}

/**
 * Factory — mint a PostgresConnector bound to the given SecretResolver and config.
 *
 * This is the single construction site for PostgresConnector. The server-layer
 * connector factory calls this after minting the bound resolver from
 * `vault.withSecret.bind(vault, ref)`.
 *
 * @param auth   - SecretResolver pre-bound to this DataSource's credential ref
 * @param config - Postgres config (connectionStringRef, optional defaultSchema)
 */
export function makePostgresConnector(
  auth: SecretResolver,
  config: PostgresConnectorConfig,
): PostgresConnector {
  return new PostgresConnector(auth, config);
}
