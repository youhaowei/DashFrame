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
 * Request body (JSON): a compiled query `{ sql, params }` — the same shape the
 * content-hash cache (Stage 4) keys on. (Insight-reference resolution — id →
 * compiled SQL — is the renderer/server function layer's job and lands as a
 * thin wrapper that produces this body; the data path itself is compile-agnostic.)
 */
import { Hono } from "hono";

import type { CompiledQuery } from "./compile";

export const ARROW_STREAM_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

/** What the data path needs from an engine: compiled SQL → Arrow IPC bytes. */
export interface ArrowQueryRunner {
  queryArrow(sql: string, params?: readonly unknown[]): Promise<Uint8Array>;
}

export interface ArrowDataPathOptions {
  /** The engine that executes compiled SQL and returns Arrow IPC. */
  engine: ArrowQueryRunner;
  /**
   * Per-launch loopback bearer token. When set, every request must carry
   * `Authorization: Bearer <token>`. When unset, the path is open (loopback
   * `dashframe serve` without `--token`) — the same policy as the WyStack
   * server's optional auth.
   */
  authToken?: string;
}

interface ArrowRequestBody {
  sql?: unknown;
  params?: unknown;
}

/**
 * Build a Hono router exposing `POST /arrow` that streams Arrow IPC for a
 * compiled query. Mount it on the loopback host (e.g. under `/data`).
 */
export function createArrowDataPath(options: ArrowDataPathOptions): Hono {
  const app = new Hono();

  app.post("/arrow", async (c) => {
    if (
      options.authToken &&
      !tokenOk(c.req.header("authorization"), options.authToken)
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: ArrowRequestBody;
    try {
      body = (await c.req.json()) as ArrowRequestBody;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const compiled = parseCompiledQuery(body);
    if (!compiled) {
      return c.json(
        { error: "Body must be { sql: string, params?: unknown[] }" },
        400,
      );
    }

    let arrow: Uint8Array;
    try {
      arrow = await options.engine.queryArrow(compiled.sql, compiled.params);
    } catch {
      // Keep engine errors opaque. queryArrow throws for any SQL error (syntax,
      // type mismatch, missing table); the raw DuckDB message would otherwise
      // reach the client through Hono's default error handler, leaking
      // engine-layer internals over the loopback data channel.
      return c.json({ error: "Query execution failed" }, 500);
    }
    return new Response(arrow, {
      status: 200,
      headers: { "Content-Type": ARROW_STREAM_CONTENT_TYPE },
    });
  });

  return app;
}

function parseCompiledQuery(body: ArrowRequestBody): CompiledQuery | null {
  if (typeof body.sql !== "string" || body.sql.trim() === "") return null;
  // A present-but-non-array `params` (e.g. a scalar 42) must be a clear 400,
  // not silently coerced to [] — that would surface later as a binding
  // mismatch and an opaque 500 from the engine.
  if (body.params !== undefined && !Array.isArray(body.params)) return null;
  const params = Array.isArray(body.params) ? body.params : [];
  return { sql: body.sql, params };
}

function tokenOk(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  // Constant-time-ish: same-length compare. The loopback token is high-entropy
  // and the surface is local-only, so a length-leak is not a meaningful vector
  // here, but avoid early-exit on the common-prefix case.
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
