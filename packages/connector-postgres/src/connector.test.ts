/**
 * PostgresConnector tests
 *
 * Pattern: makePostgresConnector(auth, config) — the connector is auth-blind.
 * For vault tests we build a TestBackend vault and mint a bound resolver.
 * For pg interaction tests we subclass PostgresConnector and inject a spy
 * client via overriding createClient() — no real pg connection needed.
 *
 * WARNING: TestBackend / InMemoryMappingStore / SecretRegistry / SecretVault
 * are CI/dev-only doubles — NEVER import these in production or renderer code.
 */

import type { SecretResolver } from "@dashframe/engine";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { tableFromIPC } from "apache-arrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgClientLike, PgFieldDef, PgQueryConfig } from "./connector.js";
import {
  PostgresConnector,
  assertReadOnlyQuery,
  listTablesInSchema,
  makePostgresConnector,
  pgOidToColumnType,
} from "./connector.js";
import type { PostgresConnectorConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Vault factory
// ---------------------------------------------------------------------------

async function makeTestVaultWithSecret(plaintext: string) {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  const ref = await vault.store(plaintext, { class: "connector-key" });
  return { vault, ref };
}

function makeBoundResolver(
  vault: SecretVault,
  ref: Awaited<ReturnType<SecretVault["store"]>>,
): SecretResolver {
  return (use) => vault.withSecret(ref, use);
}

// ---------------------------------------------------------------------------
// Spy client builder
//
// Returns a PgClientLike whose query() calls are tracked via a vi.fn() spy.
// The first query is assumed to be the read-only SET statement; subsequent
// calls return the rows passed to the factory.
//
// query() accepts either a string or a PgQueryConfig object — normalize to
// extract the text in both cases.
// ---------------------------------------------------------------------------

interface SpyClient extends PgClientLike {
  spy: ReturnType<typeof vi.fn>;
}

/** Extract the SQL text from either call form (string | PgQueryConfig). */
function callText(arg: string | PgQueryConfig): string {
  return typeof arg === "string" ? arg : arg.text;
}

function makeSpyClient(
  dataRows: Record<string, unknown>[] = [],
  dataFields: PgFieldDef[] = [],
): SpyClient {
  const spy = vi.fn();

  // The spy handles three call shapes:
  //   1. SET SESSION CHARACTERISTICS... (returns empty rows)
  //   2. SET search_path TO ... (returns empty rows — for listTablesInSchema)
  //   3. Any other query (returns dataRows + dataFields)
  // The first arg may be a string OR a PgQueryConfig object (when queryMode is set).
  spy.mockImplementation((arg: string | PgQueryConfig) => {
    const upper = callText(arg).toUpperCase().trim();
    if (upper.startsWith("SET")) {
      return Promise.resolve({ rows: [], fields: [] });
    }
    return Promise.resolve({ rows: dataRows, fields: dataFields });
  });

  return {
    spy,
    query: spy as unknown as PgClientLike["query"],
    end: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Injectable subclass
//
// Overrides createClient to inject a spy client without touching real pg.
// ---------------------------------------------------------------------------

class TestPostgresConnector extends PostgresConnector {
  #clientToInject: PgClientLike | null = null;

  injectClient(client: PgClientLike): void {
    this.#clientToInject = client;
  }

  protected override async createClient(_dsn: string): Promise<PgClientLike> {
    if (this.#clientToInject) {
      return this.#clientToInject;
    }
    throw new Error("TestPostgresConnector: no client injected");
  }
}

function makeTestConnector(
  auth: SecretResolver,
  config: PostgresConnectorConfig,
  client: PgClientLike,
): TestPostgresConnector {
  const connector = new TestPostgresConnector(auth, config);
  connector.injectClient(client);
  return connector;
}

// Simple noop resolver — yields a non-empty DSN so fail-closed doesn't fire.
const testDsn = "postgres://user:pass@localhost:5432/testdb";
const noopDsnResolver: SecretResolver = (use) => use(testDsn);
const emptyDsnResolver: SecretResolver = (use) => use("");

const baseConfig: PostgresConnectorConfig = {
  connectionStringRef: "secret:00000000-0000-0000-0000-000000000001",
  defaultSchema: "public",
};

// ---------------------------------------------------------------------------
// Unit: assertReadOnlyQuery
// ---------------------------------------------------------------------------

describe("assertReadOnlyQuery", () => {
  it("accepts SELECT", () => {
    expect(() => assertReadOnlyQuery("SELECT * FROM foo")).not.toThrow();
  });

  it("accepts WITH (CTE)", () => {
    expect(() =>
      assertReadOnlyQuery("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    ).not.toThrow();
  });

  it("accepts EXPLAIN", () => {
    expect(() => assertReadOnlyQuery("EXPLAIN SELECT 1")).not.toThrow();
  });

  it("accepts TABLE shorthand", () => {
    expect(() => assertReadOnlyQuery("TABLE foo")).not.toThrow();
  });

  it("accepts SELECT after leading line comment", () => {
    expect(() =>
      assertReadOnlyQuery("-- fetch all\nSELECT * FROM foo"),
    ).not.toThrow();
  });

  it("accepts SELECT after leading block comment", () => {
    expect(() =>
      assertReadOnlyQuery("/* get rows */ SELECT * FROM foo"),
    ).not.toThrow();
  });

  it("is case-insensitive", () => {
    expect(() => assertReadOnlyQuery("select * from foo")).not.toThrow();
    expect(() => assertReadOnlyQuery("Select 1")).not.toThrow();
  });

  it("rejects DROP", () => {
    expect(() => assertReadOnlyQuery("DROP TABLE foo")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("rejects INSERT", () => {
    expect(() => assertReadOnlyQuery("INSERT INTO foo VALUES (1)")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("rejects UPDATE", () => {
    expect(() => assertReadOnlyQuery("UPDATE foo SET x=1")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("rejects DELETE", () => {
    expect(() => assertReadOnlyQuery("DELETE FROM foo")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("rejects CREATE", () => {
    expect(() => assertReadOnlyQuery("CREATE TABLE foo (id int)")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("does NOT match SELECT token inside a DROP (keyword-anywhere trap)", () => {
    // "DROP TABLE select_log" — first token is DROP, not SELECT.
    expect(() => assertReadOnlyQuery("DROP TABLE select_log")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("rejects empty/whitespace-only input", () => {
    expect(() => assertReadOnlyQuery("   ")).toThrow(
      /non-SELECT query rejected/i,
    );
  });

  it("rejects DROP after leading comment (comment-bypass attempt)", () => {
    expect(() => assertReadOnlyQuery("-- SELECT\nDROP TABLE foo")).toThrow(
      /non-SELECT query rejected/i,
    );
  });
});

// ---------------------------------------------------------------------------
// AC1 — Non-SELECT is rejected BEFORE client.query is called
// ---------------------------------------------------------------------------

describe("AC1 — non-SELECT rejected at allowlist, before any client.query", () => {
  it("throws for DROP TABLE before any pg query call", async () => {
    const spyClient = makeSpyClient();
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await expect(
      connector.query("DROP TABLE foo", crypto.randomUUID()),
    ).rejects.toThrow(/non-SELECT query rejected/i);

    // The allowlist check runs BEFORE the auth/client path is entered —
    // so even the SET SESSION statement is never issued. Zero pg calls total.
    expect(spyClient.spy).not.toHaveBeenCalled();
  });

  it("throws for INSERT before any pg query call", async () => {
    const spyClient = makeSpyClient();
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await expect(
      connector.query("INSERT INTO foo VALUES (1)", crypto.randomUUID()),
    ).rejects.toThrow(/non-SELECT query rejected/i);

    expect(spyClient.spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC2 — First query on every connection is the read-only SET statement
// ---------------------------------------------------------------------------

// Normalize spy call first arg — may be a string or a PgQueryConfig object.
type SpyCall = [string | PgQueryConfig, ...unknown[]];

function spyCallText(c: SpyCall): string {
  return callText(c[0]);
}

describe("AC2 — SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY is first query", () => {
  it("issues the read-only SET before any query in connect()", async () => {
    const spyClient = makeSpyClient([{ table_name: "users" }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await connector.connect();

    const calls = spyClient.spy.mock.calls as SpyCall[];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(spyCallText(calls[0]!).toUpperCase()).toBe(
      "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
    );
  });

  it("issues the read-only SET before the data query in query()", async () => {
    const spyClient = makeSpyClient([{ id: 1, name: "Alice" }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await connector.query("SELECT * FROM users", crypto.randomUUID());

    const calls = spyClient.spy.mock.calls as SpyCall[];
    // Connection setup: SET SESSION CHARACTERISTICS + SET statement_timeout + data query.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(spyCallText(calls[0]!).toUpperCase()).toBe(
      "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
    );
    // The SELECT must come AFTER both SET statements.
    const selectIdx = calls.findIndex((c) =>
      spyCallText(c).toUpperCase().includes("SELECT"),
    );
    expect(selectIdx).toBeGreaterThan(0);
  });

  it("issues SET statement_timeout immediately after the read-only SET", async () => {
    const spyClient = makeSpyClient([{ id: 1, name: "Alice" }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await connector.query("SELECT * FROM users", crypto.randomUUID());

    const calls = spyClient.spy.mock.calls as SpyCall[];
    // Second call (index 1) must be the statement_timeout guard.
    expect(spyCallText(calls[1]!).toUpperCase()).toContain("STATEMENT_TIMEOUT");
  });

  it("sends user SQL via extended query protocol (queryMode: 'extended')", async () => {
    // `queryMode: "extended"` forces node-postgres onto the Parse/Bind/Execute
    // path. Postgres rejects multi-statement SQL during Parse in that path,
    // closing the `SELECT 1; BEGIN READ WRITE; …` bypass.
    // The spy can't enforce the wire-level rejection, but we verify that the
    // config object with queryMode is what reaches pg — not a bare string call.
    const spyClient = makeSpyClient([{ n: 1 }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await connector.query("SELECT 1 AS n", crypto.randomUUID());

    const calls = spyClient.spy.mock.calls as SpyCall[];
    // Find the SELECT call — it's the config-object form.
    const selectCall = calls.find((c) =>
      spyCallText(c).toUpperCase().startsWith("SELECT"),
    );
    expect(selectCall).toBeDefined();
    // First arg must be a PgQueryConfig object with queryMode: "extended".
    const arg = selectCall![0];
    expect(typeof arg).toBe("object");
    expect((arg as PgQueryConfig).queryMode).toBe("extended");
    expect((arg as PgQueryConfig).text).toBe("SELECT 1 AS n");
  });
});

// ---------------------------------------------------------------------------
// AC3 — Credential never plaintext in config
// ---------------------------------------------------------------------------

describe("AC3 — credential never plaintext in config", () => {
  it("config stores a SecretRef string, never a postgres:// DSN", () => {
    const plainDsn = "postgres://user:pass@host:5432/db";
    const config: PostgresConnectorConfig = {
      connectionStringRef: "secret:00000000-0000-0000-0000-000000000002",
    };

    const connector = makePostgresConnector(noopDsnResolver, config);

    // Inspect all enumerable and own non-enumerable properties on the instance.
    // The plaintext DSN must NOT appear as any property value.
    const proto = Object.getPrototypeOf(connector) as object;
    const ownKeys = [
      ...Object.getOwnPropertyNames(connector),
      ...Object.getOwnPropertyNames(proto),
    ];
    for (const key of ownKeys) {
      try {
        const val = (connector as unknown as Record<string, unknown>)[key];
        if (typeof val === "string") {
          expect(val).not.toBe(plainDsn);
          expect(val).not.toContain("postgres://");
        }
      } catch {
        // Private fields / accessors may throw — that's fine.
      }
    }

    // connectionStringRef must be a SecretRef pattern or omitted.
    // (We set it explicitly, so check it's the ref we gave.)
    const configRef = config.connectionStringRef;
    expect(configRef).toMatch(/^secret:/);
    expect(configRef).not.toContain("postgres://");
  });

  it("fail-closed: empty DSN from resolver throws before creating a client", async () => {
    const spyClient = makeSpyClient();
    const connector = makeTestConnector(
      emptyDsnResolver,
      baseConfig,
      spyClient,
    );

    await expect(connector.connect()).rejects.toThrow(/fail-closed/i);
    // The spy client was never reached.
    expect(spyClient.spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC4 — Identifier quoting: double-quote in schema name is escaped
// ---------------------------------------------------------------------------

describe("AC4 — identifier quoting", () => {
  it("quotes a schema name containing a double-quote in SET search_path", async () => {
    const evilSchema = 'public"injection';
    const spyClient = makeSpyClient([]);

    // Call listTablesInSchema directly to isolate the quoting path.
    await listTablesInSchema(spyClient, evilSchema);

    const calls = spyClient.spy.mock.calls as Array<[string, ...unknown[]]>;

    // First call is SET search_path — the schema must be double-quoted with
    // the embedded " doubled: "public""injection"
    const setCall = calls.find((c) => String(c[0]).includes("search_path"));
    expect(setCall).toBeDefined();
    const setQuery = String(setCall?.[0] ?? "");
    expect(setQuery).toContain('"public""injection"');
    // Must NOT contain the raw unescaped name.
    expect(setQuery).not.toContain(`'${evilSchema}'`);

    // Second call is the information_schema SELECT — schema passed as $1 value.
    const selectCall = calls.find((c) =>
      String(c[0]).toLowerCase().includes("information_schema"),
    );
    expect(selectCall).toBeDefined();
    // The schema value must appear as the $1 parameter array entry, not
    // interpolated into the SQL text.
    const paramValues = selectCall?.[1] as unknown[];
    expect(paramValues).toBeDefined();
    expect(paramValues?.[0]).toBe(evilSchema);

    // The SQL text itself must NOT contain the unquoted evil schema.
    const selectQuery = String(selectCall?.[0] ?? "");
    expect(selectQuery).toContain("$1");
    expect(selectQuery).not.toContain(evilSchema);
  });

  it("quotes table name with double-quote when fetching by table ref", async () => {
    const spyClient = makeSpyClient([{ id: 1, name: "Alice" }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    // Trigger the table-ref path: "schema.table" format.
    await connector.query('public.my"table', crypto.randomUUID());

    const calls = spyClient.spy.mock.calls as Array<[string, ...unknown[]]>;
    const fetchCall = calls.find((c) =>
      String(c[0]).toUpperCase().startsWith("SELECT * FROM"),
    );
    expect(fetchCall).toBeDefined();
    // Table name "my"table" must be quoted as "my""table"
    expect(String(fetchCall?.[0] ?? "")).toContain('"my""table"');
  });
});

// ---------------------------------------------------------------------------
// AC5 — Arrow output shape matches registry contract
// ---------------------------------------------------------------------------

describe("AC5 — Arrow output shape matches registry contract", () => {
  it("returns arrowBuffer (base64), fieldIds, fields, rowCount for a two-column result", async () => {
    const tableId = crypto.randomUUID();
    const testRows = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const spyClient = makeSpyClient(testRows);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const result = await connector.query("SELECT * FROM users", tableId);

    // Shape contract
    expect(typeof result.arrowBuffer).toBe("string");
    expect(Array.isArray(result.fieldIds)).toBe(true);
    expect(Array.isArray(result.fields)).toBe(true);
    expect(result.rowCount).toBe(2);

    // fieldIds and fields must be aligned.
    expect(result.fieldIds).toHaveLength(result.fields.length);

    // Deserialize Arrow buffer and verify column names.
    const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
    const table = tableFromIPC(bytes);
    const colNames = table.schema.fields.map((f) => f.name);

    // Both "id" and "name" columns must be present.
    const fieldNames = result.fields.map((f) => f.name);
    for (const name of fieldNames) {
      expect(colNames).toContain(name);
    }
    expect(table.numRows).toBe(2);
  });

  it("returns rowCount = 0 for an empty result set (no pg column metadata)", async () => {
    // When the spy provides no fields metadata (legacy / no OID info),
    // the result is an empty schema — this is the pre-fix baseline.
    const spyClient = makeSpyClient([], []);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const result = await connector.query(
      "SELECT * FROM empty",
      crypto.randomUUID(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.fields).toHaveLength(0);
    expect(result.fieldIds).toHaveLength(0);
    // arrowBuffer should still be a valid base64 string (empty Arrow table).
    expect(typeof result.arrowBuffer).toBe("string");
    expect(result.arrowBuffer.length).toBeGreaterThan(0);
  });

  it("preserves schema from pg column metadata on a zero-row result (empty-result schema fix)", async () => {
    // Simulate pg returning column descriptors even when rows is empty.
    const pgFields: PgFieldDef[] = [
      { name: "id", dataTypeID: 23 }, // int4
      { name: "amount", dataTypeID: 1700 }, // NUMERIC
    ];
    const spyClient = makeSpyClient([], pgFields);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const result = await connector.query(
      "SELECT id, amount FROM ledger WHERE 1=0",
      crypto.randomUUID(),
    );

    expect(result.rowCount).toBe(0);
    // Schema must be inferred from pg column metadata, not from rows.
    expect(result.fields).toHaveLength(2);
    expect(result.fieldIds).toHaveLength(2);
    const fieldNames = result.fields.map((f) => f.name);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("amount");
    // NUMERIC (OID 1700) must map to "string" — lossless coercion.
    const amountField = result.fields.find((f) => f.name === "amount");
    expect(amountField?.type).toBe("string");
  });

  it("returns correct rowCount for connect() listing tables", async () => {
    const spyClient = makeSpyClient([
      { table_name: "users" },
      { table_name: "orders" },
    ]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const databases = await connector.connect();

    expect(databases).toHaveLength(2);
    expect(databases[0]).toEqual({
      id: "public.users",
      name: "users",
    });
    expect(databases[1]).toEqual({
      id: "public.orders",
      name: "orders",
    });
  });
});

// ---------------------------------------------------------------------------
// Pagination pushdown — table-ref path emits LIMIT/OFFSET into the SQL
// ---------------------------------------------------------------------------

describe("pagination pushdown (table-ref path)", () => {
  it("pushes LIMIT $1 OFFSET $2 into the SQL with bound params when limit is set", async () => {
    const spyClient = makeSpyClient([{ id: 1 }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    // "public.users" is a table ref (one dot, no spaces) → fetchTable path.
    await connector.query("public.users", crypto.randomUUID(), {
      pagination: { offset: 20, limit: 50 },
    });

    const calls = spyClient.spy.mock.calls as SpyCall[];
    const fetchCall = calls.find((c) =>
      spyCallText(c).toUpperCase().startsWith("SELECT * FROM"),
    );
    expect(fetchCall).toBeDefined();
    // Emitted SQL carries the bound window, NOT a literal.
    expect(spyCallText(fetchCall!)).toContain("LIMIT $1 OFFSET $2");
    // limit/offset are passed as value params (no interpolation).
    expect(fetchCall![1]).toEqual([50, 20]);
  });

  it("emits a plain SELECT (no LIMIT) when no pagination is requested", async () => {
    const spyClient = makeSpyClient([{ id: 1 }]);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    await connector.query("public.users", crypto.randomUUID());

    const calls = spyClient.spy.mock.calls as SpyCall[];
    const fetchCall = calls.find((c) =>
      spyCallText(c).toUpperCase().startsWith("SELECT * FROM"),
    );
    expect(fetchCall).toBeDefined();
    expect(spyCallText(fetchCall!)).not.toContain("LIMIT");
  });
});

// ---------------------------------------------------------------------------
// Arrow-reserved column names are dropped before serialization
// ---------------------------------------------------------------------------

describe("reserved column names (Arrow safety)", () => {
  it("drops __proto__/constructor/prototype columns before building Arrow", async () => {
    // A row whose keys include Arrow-hostile names alongside a real column.
    // Build with defineProperty so `__proto__` is an OWN ENUMERABLE key (an
    // object literal `{ __proto__: ... }` would set the prototype instead).
    const row: Record<string, unknown> = { id: 1 };
    for (const k of ["__proto__", "constructor", "prototype"]) {
      Object.defineProperty(row, k, {
        value: "danger",
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    const rows = [row];
    const spyClient = makeSpyClient(rows);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    // Must not throw (unfiltered, these crash tableFromArrays).
    const result = await connector.query(
      "SELECT * FROM weird",
      crypto.randomUUID(),
    );

    const fieldNames = result.fields.map((f) => f.name);
    expect(fieldNames).toContain("id");
    expect(fieldNames).not.toContain("__proto__");
    expect(fieldNames).not.toContain("constructor");
    expect(fieldNames).not.toContain("prototype");

    // The Arrow buffer must deserialize and expose only the safe column.
    const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
    const table = tableFromIPC(bytes);
    const colNames = table.schema.fields.map((f) => f.name);
    expect(colNames).toEqual(["id"]);
  });
});

// ---------------------------------------------------------------------------
// Static metadata
// ---------------------------------------------------------------------------

describe("static metadata", () => {
  const c = makePostgresConnector(noopDsnResolver, baseConfig);

  it("has id = 'postgres'", () => {
    expect(c.id).toBe("postgres");
  });

  it("has sourceType = 'remote-api'", () => {
    expect(c.sourceType).toBe("remote-api");
  });

  it("is an instance of PostgresConnector", () => {
    expect(c).toBeInstanceOf(PostgresConnector);
  });

  it("getFormFields includes connectionString and defaultSchema", () => {
    const fields = c.getFormFields();
    const names = fields.map((f) => f.name);
    expect(names).toContain("connectionString");
    expect(names).toContain("defaultSchema");
  });

  it("validate() fails when connectionString is absent", () => {
    const result = c.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors?.["connectionString"]).toBeTruthy();
  });

  it("validate() passes when connectionString is present", () => {
    const result = c.validate({
      connectionString: "postgres://user:pass@host:5432/db",
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vault round-trip: SecretResolver wired to real vault
// ---------------------------------------------------------------------------

describe("vault round-trip: bound resolver from real SecretVault", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves DSN from vault and passes it to createClient", async () => {
    const plainDsn = "postgres://vault-user:vault-pass@host:5432/testdb";
    const { vault, ref } = await makeTestVaultWithSecret(plainDsn);
    const auth = makeBoundResolver(vault, ref);

    let capturedDsn: string | undefined;

    class CapturingConnector extends PostgresConnector {
      protected override async createClient(
        dsn: string,
      ): Promise<PgClientLike> {
        capturedDsn = dsn;
        // Return a spy client to avoid real pg call.
        const spyClient = makeSpyClient([]);
        return spyClient;
      }
    }

    const config: PostgresConnectorConfig = {
      connectionStringRef: ref,
    };
    const connector = new CapturingConnector(auth, config);
    await connector.connect();

    expect(capturedDsn).toBe(plainDsn);
    // The plaintext DSN only appeared inside createClient — not on the connector.
    expect(
      (connector as unknown as Record<string, unknown>)["dsn"],
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: resolver throws
// ---------------------------------------------------------------------------

describe("fail-closed: resolver failure", () => {
  it("throws before constructing a client when the resolver rejects", async () => {
    const failResolver: SecretResolver = async (_use) => {
      throw new Error("vault unavailable");
    };
    const spyClient = makeSpyClient();
    const connector = makeTestConnector(failResolver, baseConfig, spyClient);

    await expect(connector.connect()).rejects.toThrow(/vault unavailable/i);
    expect(spyClient.spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Read-only guard wired end-to-end
// ---------------------------------------------------------------------------

describe("read-only guard: allowlisted queries pass through to pg", () => {
  let spyClient: SpyClient;
  let connector: TestPostgresConnector;

  beforeEach(() => {
    spyClient = makeSpyClient([{ count: 42 }]);
    connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);
  });

  it("SELECT query reaches pg after SET SESSION", async () => {
    await connector.query("SELECT count(*) FROM users", crypto.randomUUID());
    const calls = spyClient.spy.mock.calls as SpyCall[];
    const queries = calls.map((c) => spyCallText(c).toUpperCase());
    expect(queries[0]).toContain("SET SESSION CHARACTERISTICS");
    expect(queries.some((q) => q.includes("SELECT"))).toBe(true);
  });

  it("WITH query passes the allowlist", async () => {
    spyClient = makeSpyClient([{ n: 1 }]);
    connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);
    await expect(
      connector.query(
        "WITH cte AS (SELECT 1 AS n) SELECT * FROM cte",
        crypto.randomUUID(),
      ),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// pgOidToColumnType — OID → ColumnType mapping
// ---------------------------------------------------------------------------

describe("pgOidToColumnType", () => {
  it("maps BIGINT (OID 20) to 'string' — preserves precision for values > 2^53", () => {
    expect(pgOidToColumnType(20)).toBe("string");
  });

  it("maps NUMERIC (OID 1700) to 'string' — preserves decimal precision", () => {
    expect(pgOidToColumnType(1700)).toBe("string");
  });

  it("returns undefined for unrecognized OIDs (fall through to value inference)", () => {
    expect(pgOidToColumnType(23)).toBeUndefined(); // int4
    expect(pgOidToColumnType(25)).toBeUndefined(); // text
    expect(pgOidToColumnType(16)).toBeUndefined(); // bool
    expect(pgOidToColumnType(700)).toBeUndefined(); // float4
  });
});

// ---------------------------------------------------------------------------
// NUMERIC / BIGINT Arrow coercion — field-type matches value-type (string)
// ---------------------------------------------------------------------------

describe("NUMERIC/BIGINT coercion: field-type and Arrow value-type must agree", () => {
  it("BIGINT column: field type is 'string' and Arrow value is a string (no precision loss)", async () => {
    // node-postgres returns BIGINT (OID 20) as a string.
    const bigValue = "9007199254740993"; // > Number.MAX_SAFE_INTEGER
    const pgFields: PgFieldDef[] = [
      { name: "big_id", dataTypeID: 20 }, // BIGINT
    ];
    const spyClient = makeSpyClient([{ big_id: bigValue }], pgFields);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const result = await connector.query(
      "SELECT big_id FROM things",
      crypto.randomUUID(),
    );

    // Field type must be "string" (matches the string value pg returns).
    const field = result.fields.find((f) => f.name === "big_id");
    expect(field?.type).toBe("string");

    // Arrow round-trip: the value must survive byte-for-byte as a string.
    const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
    const table = tableFromIPC(bytes);
    const arrowValue = table.getChildAt(0)?.get(0);
    // Arrow stores it as a string column — the exact value must be preserved.
    expect(String(arrowValue)).toBe(bigValue);
  });

  it("NUMERIC column: field type is 'string' and Arrow value is a string (no precision loss)", async () => {
    // node-postgres returns NUMERIC (OID 1700) as a string.
    const numericValue = "123456789.987654321";
    const pgFields: PgFieldDef[] = [
      { name: "amount", dataTypeID: 1700 }, // NUMERIC
    ];
    const spyClient = makeSpyClient([{ amount: numericValue }], pgFields);
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const result = await connector.query(
      "SELECT amount FROM ledger",
      crypto.randomUUID(),
    );

    // Field type must be "string".
    const field = result.fields.find((f) => f.name === "amount");
    expect(field?.type).toBe("string");

    // Arrow round-trip: exact decimal string must be preserved.
    const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
    const table = tableFromIPC(bytes);
    const arrowValue = table.getChildAt(0)?.get(0);
    expect(String(arrowValue)).toBe(numericValue);
  });

  it("mixed row: only BIGINT/NUMERIC columns are typed as 'string'; others use value inference", async () => {
    const pgFields: PgFieldDef[] = [
      { name: "id", dataTypeID: 23 }, // int4 → value inference → "number"
      { name: "balance", dataTypeID: 1700 }, // NUMERIC → "string"
      { name: "score", dataTypeID: 20 }, // BIGINT → "string"
    ];
    const spyClient = makeSpyClient(
      [{ id: 1, balance: "9999.99", score: "42" }],
      pgFields,
    );
    const connector = makeTestConnector(noopDsnResolver, baseConfig, spyClient);

    const result = await connector.query(
      "SELECT * FROM scores",
      crypto.randomUUID(),
    );

    const byName = Object.fromEntries(result.fields.map((f) => [f.name, f]));
    expect(byName["id"]?.type).toBe("number"); // int4 — value inference
    expect(byName["balance"]?.type).toBe("string"); // NUMERIC OID override
    expect(byName["score"]?.type).toBe("string"); // BIGINT OID override
  });
});
