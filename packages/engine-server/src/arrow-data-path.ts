/**
 * Stage 5 — Transport: the dedicated Arrow IPC data path.
 *
 * WyStack RPC carries metadata only; Arrow/binary rides this separate HTTP
 * endpoint — the hard boundary from the Data Path & Transport spec (D3). On
 * Electron this is mounted on the same loopback host as the WyStack server but
 * is a distinct route that streams `application/vnd.apache.arrow.stream` bytes,
 * never WyStack frames.
 *
 * Auth reuses the loopback bearer token (the same per-launch token that
 * protects WyStack HTTP/WS — PRs #47/#49). A request with no/invalid token is
 * rejected before any query runs.
 *
 * `POST /arrow`
 *   Accepts two overlapping request shapes:
 *   - Native shape: `{ sql: string, params?: unknown[] }` — used by the
 *     compiled-query cache path. Returns Arrow IPC.
 *   - Mosaic shape: `{ type: 'arrow'|'exec'|'json', sql: string }` — the
 *     protocol Mosaic's Coordinator issues to any restConnector-compatible
 *     server. Returns Arrow IPC, empty body, or JSON rows respectively.
 *
 * `POST /tables/:name`
 *   Accepts a raw Arrow IPC stream body (`application/vnd.apache.arrow.stream`)
 *   and registers it as a named in-memory table in the engine. The renderer
 *   uploads each DataFrame's Arrow buffer before issuing chart-compute queries.
 *   Only available when the engine implements `registerArrowTable` (i.e. the
 *   native engine is wired — not the web-WASM degenerate case).
 */
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { tableFromIPC } from "apache-arrow";
import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";

export const ARROW_STREAM_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

/** What the data path needs from an engine: compiled SQL → Arrow IPC bytes. */
export interface ArrowQueryRunner {
  queryArrow(sql: string, params?: readonly unknown[]): Promise<Uint8Array>;
}

/**
 * Optional extension: the engine can accept Arrow IPC buffers as named tables
 * (used by the desktop chart-compute path so the native engine has the same
 * DataFrame tables the renderer's WASM engine has).
 */
export interface ArrowTableRegistrar {
  registerArrowTable(name: string, arrow: Uint8Array): Promise<void>;
}

export interface ArrowDataPathOptions {
  /** The engine that executes compiled SQL and returns Arrow IPC. */
  engine: ArrowQueryRunner & Partial<ArrowTableRegistrar>;
  /**
   * Per-launch loopback bearer token (plaintext). When set, every request must
   * carry `Authorization: Bearer <token>`. When unset, the path is open
   * (loopback `dashframe serve` without `--token`) — the same policy as the
   * WyStack server's optional auth.
   *
   * Mutually exclusive with `authRef` + `vault`. Kept for backward compat
   * (existing tests and `dashframe serve`).
   */
  authToken?: string;
  /**
   * Vault-backed auth ref — the vault-stored alternative to `authToken`.
   * When both `authRef` and `vault` are present, token verification resolves
   * the expected value from the vault at each request rather than comparing
   * against a plaintext field. `authToken` is ignored when this pair is set.
   */
  authRef?: SecretRef;
  /**
   * The SecretVault instance paired with `authRef`. Must be provided whenever
   * `authRef` is set.
   */
  vault?: SecretVault;
}

/** Native shape: `{ sql, params? }` */
interface NativeRequestBody {
  sql?: unknown;
  params?: unknown;
  type?: undefined;
}

/**
 * Mosaic Coordinator shape: `{ type: 'arrow' | 'exec' | 'json', sql: string }`.
 * Cache and priority fields are stripped by the Coordinator before sending.
 */
interface MosaicRequestBody {
  type: "arrow" | "exec" | "json";
  sql?: unknown;
}

type RequestBody = NativeRequestBody | MosaicRequestBody;

/**
 * Dispatch a parsed Arrow query body to the engine and return an HTTP Response.
 * Extracted to keep the Hono handler below the sonarjs cognitive-complexity cap.
 */
async function dispatchArrowQuery(
  engine: ArrowQueryRunner,
  body: RequestBody,
): Promise<Response> {
  const sql = typeof body.sql === "string" ? body.sql.trim() : "";
  if (!sql) {
    return Response.json(
      { error: "Body must include a non-empty sql string" },
      { status: 400 },
    );
  }

  // Determine query type: Mosaic sends explicit `type`; the native compiled
  // path has no `type` field and always wants Arrow IPC.
  let queryType: "arrow" | "exec" | "json";
  if (body.type === "exec") {
    queryType = "exec";
  } else if (body.type === "json") {
    queryType = "json";
  } else {
    queryType = "arrow";
  }

  // Validate params on the native path (no `type` field). Mosaic never sends
  // params, so only the native compiled-query path can hit this. A scalar
  // params silently coerced to [] would produce a binding-mismatch 500 later;
  // fail clearly at the request boundary instead.
  if (
    !body.type &&
    "params" in body &&
    body.params !== undefined &&
    !Array.isArray(body.params)
  ) {
    return Response.json({ error: "params must be an array" }, { status: 400 });
  }

  if (queryType === "exec") {
    try {
      await engine.queryArrow(sql, []);
    } catch {
      return Response.json(
        { error: "Query execution failed" },
        { status: 500 },
      );
    }
    return new Response(null, { status: 200 });
  }

  let arrow: Uint8Array;
  try {
    arrow = await engine.queryArrow(sql, parseParams(body));
  } catch {
    return Response.json({ error: "Query execution failed" }, { status: 500 });
  }

  if (queryType === "json") {
    try {
      return Response.json(arrowIpcToJsonRows(arrow));
    } catch {
      return Response.json(
        { error: "Result serialization failed" },
        { status: 500 },
      );
    }
  }

  return new Response(arrow, {
    status: 200,
    headers: { "Content-Type": ARROW_STREAM_CONTENT_TYPE },
  });
}

/**
 * Resolve whether the incoming request is authorized.
 *
 * FAIL-CLOSED contract. An auth gate must never wave a request through on an
 * error or misconfiguration — that is the worst failure mode for a security
 * boundary. Every branch that cannot positively confirm the token denies it.
 *
 * Priority:
 *   1. `authRef` set — vault-backed auth is configured. The expected token is
 *      resolved from the vault at call time (no plaintext held in a field). If
 *      `vault` is missing (misconfiguration), or `withSecret` rejects (e.g. a
 *      missing/corrupt keychain blob), the request is DENIED — never allowed.
 *   2. `authToken` set — compare against the plaintext bearer token (legacy /
 *      backward-compat path for tests and `dashframe serve`).
 *   3. Neither — no auth configured; the path is open (loopback dev / serve
 *      without a token). This is the only allow-without-token branch and it is
 *      reached ONLY when the caller configured no auth at all.
 *
 * Returns `true` only when auth passes or no auth is configured; `false` in
 * every other case (wrong token, missing vault, resolution failure).
 */
async function checkAuth(
  authHeader: string | undefined,
  options: ArrowDataPathOptions,
): Promise<boolean> {
  if (options.authRef) {
    // Vault is required whenever authRef is set. createArrowDataPath enforces
    // this at construction, but defend here too: a missing vault means we
    // cannot resolve the expected token, so we must DENY (fail closed), never
    // fall through to the open branch.
    if (!options.vault) return false;
    try {
      return await options.vault.withSecret(options.authRef, async (expected) =>
        tokenOk(authHeader, expected),
      );
    } catch {
      // Resolution failed (missing/corrupt keychain blob, vault error). Auth
      // cannot be confirmed → deny. Surfaces to the caller as 401, not 500.
      return false;
    }
  }
  if (options.authToken) {
    return tokenOk(authHeader, options.authToken);
  }
  return true; // no auth configured — path is open
}

/**
 * Build a Hono router exposing the Arrow data path.
 * Mount it on the loopback host (e.g. under `/data`).
 */
export function createArrowDataPath(options: ArrowDataPathOptions): Hono {
  // Fail-closed invariant: authRef requires vault. Without the vault the ref
  // cannot be resolved and the gate would have no way to validate tokens.
  // Refuse to construct the router rather than silently run an unguarded path.
  if (options.authRef && !options.vault) {
    throw new Error(
      "createArrowDataPath: authRef requires vault — supply a SecretVault " +
        "instance when using vault-backed auth.",
    );
  }

  const app = new Hono();

  // -------------------------------------------------------------------------
  // POST /arrow  — query endpoint (native shape + Mosaic Coordinator shape)
  // -------------------------------------------------------------------------
  app.post("/arrow", async (c) => {
    if (!(await checkAuth(c.req.header("authorization"), options))) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: RequestBody;
    try {
      body = (await c.req.json()) as RequestBody;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    return dispatchArrowQuery(options.engine, body);
  });

  // -------------------------------------------------------------------------
  // POST /tables/:name  — register an Arrow IPC buffer as a named table
  // -------------------------------------------------------------------------
  app.post("/tables/:name", async (c) => {
    if (!(await checkAuth(c.req.header("authorization"), options))) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const name = c.req.param("name");
    if (!name || !/^[a-zA-Z_]\w*$/.test(name)) {
      return c.json(
        { error: "Table name must be a valid SQL identifier" },
        400,
      );
    }

    // Reject non-Arrow content at the boundary — a wrong Content-Type means
    // the client sent the wrong format; a 415 is clearer than a 500 from
    // registerArrowTable trying to decode garbage as Arrow IPC.
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes(ARROW_STREAM_CONTENT_TYPE)) {
      return c.json(
        {
          error: `Content-Type must be ${ARROW_STREAM_CONTENT_TYPE}`,
        },
        415,
      );
    }

    // Engine must support Arrow table registration (native engine only).
    if (typeof options.engine.registerArrowTable !== "function") {
      return c.json(
        {
          error:
            "Engine does not support Arrow table registration on this surface",
        },
        501,
      );
    }

    let arrowBytes: Uint8Array;
    try {
      const buf = await c.req.arrayBuffer();
      arrowBytes = new Uint8Array(buf);
    } catch {
      return c.json({ error: "Failed to read request body" }, 400);
    }

    if (arrowBytes.byteLength === 0) {
      return c.json({ error: "Empty Arrow IPC body" }, 400);
    }

    try {
      await options.engine.registerArrowTable(name, arrowBytes);
    } catch {
      return c.json({ error: "Failed to register table" }, 500);
    }

    return c.json({ ok: true, name });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseParams(body: RequestBody): readonly unknown[] {
  // Mosaic requests don't carry params (SQL is fully resolved by the time it
  // reaches the connector). The native compiled-query path may supply them.
  if ("params" in body && Array.isArray(body.params)) {
    return body.params as readonly unknown[];
  }
  return [];
}

/**
 * Decode an Arrow IPC stream buffer into plain JSON rows.
 * Used for Mosaic 'json' query type (column stats, DESCRIBE, etc.).
 */
function arrowIpcToJsonRows(arrow: Uint8Array): Record<string, unknown>[] {
  const table = tableFromIPC(arrow);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const field of table.schema.fields) {
      const col = table.getChild(field.name);
      const val = col?.get(i);
      row[field.name] = typeof val === "bigint" ? Number(val) : val;
    }
    rows.push(row);
  }
  return rows;
}

function tokenOk(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  // Hash both sides to fixed-length SHA-256 digests before the constant-time
  // compare, so neither the length nor any prefix of the token leaks via timing.
  // This matches the server's tokenMatches (app.ts) — one comparison discipline
  // across both auth sinks.
  const actualBytes = createHash("sha256").update(token).digest();
  const expectedBytes = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualBytes, expectedBytes);
}
