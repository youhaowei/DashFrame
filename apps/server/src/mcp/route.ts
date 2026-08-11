import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { WyStackApp } from "@wystack/server";
import type { Context } from "hono";

import { draftIdFromBatchError } from "../functions/draft-batch";
import { createMcpTools, type McpTool } from "./tools";

export interface McpRequestContext {
  principal: unknown;
  draftId?: string;
}

export type McpMode = "stateful" | "stateless";

interface McpRouteOptions {
  app: WyStackApp;
  mode?: McpMode;
  maxStatefulSessions?: number;
  statefulSessionTtlMs?: number;
  now?: () => number;
  resolveContext(request: Request): Promise<Record<string, unknown>>;
}

interface ActiveMcpSession {
  context: McpRequestContext;
  principalKey: string;
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  lastSeenAt: number;
}

/**
 * Whether the resolver produced a principal this route will act as. A resolver
 * that succeeds without identifying anyone is not an authenticated caller, so
 * the shape is checked here rather than trusted downstream.
 */
function isIdentifiedPrincipal(context: Record<string, unknown>): boolean {
  const principal = context.principal;
  if (typeof principal !== "object" || principal === null) return false;
  const record = principal as Record<string, unknown>;
  if (record.kind === "service") return typeof record.credentialId === "string";
  if (record.kind === "user") return typeof record.userId === "string";
  return false;
}

function contextPrincipalKey(context: Record<string, unknown>): string | null {
  if (!isIdentifiedPrincipal(context)) return null;
  const principal = context.principal as Record<string, unknown>;
  return principal.kind === "service"
    ? `service:${principal.credentialId as string}`
    : `user:${principal.userId as string}`;
}

/**
 * The draft id an agent supplies alongside a tool call's arguments. Read tools
 * advertise it, and it scopes their overlay for this request only.
 *
 * Deliberately single-message: a JSON-RPC array has no `params` of its own, so
 * a batch would silently read canonical state while carrying a draft id. Batch
 * bodies are refused outright by `isJsonRpcBatch` rather than answered wrongly.
 */
function requestDraftId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const params = (body as Record<string, unknown>).params;
  if (typeof params !== "object" || params === null) return undefined;
  const args = (params as Record<string, unknown>).arguments;
  if (typeof args !== "object" || args === null) return undefined;
  const draftId = (args as Record<string, unknown>).draftId;
  return typeof draftId === "string" ? draftId : undefined;
}

/**
 * JSON-RPC batching left the MCP spec in 2025-06-18 and no current client emits
 * it, but the transport would still accept an array and answer it. That is the
 * one shape where a draft id rides in a place `requestDraftId` cannot see, so a
 * batched read would quietly return canonical state instead of the overlay the
 * caller asked for. A wrong answer is worse than a refusal.
 */
function isJsonRpcBatch(body: unknown): boolean {
  return Array.isArray(body);
}

/**
 * Transport-level failures answer with a real HTTP status, not a 200 carrying
 * a JSON-RPC error body. An MCP client that has not completed a handshake
 * cannot interpret a JSON-RPC envelope, and a proxy or agent runtime between
 * the two reads only the status line.
 */
function jsonRpcError(
  status: 400 | 401 | 403 | 404 | 500 | 503,
  code: number,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * GET (a standalone server-to-client SSE stream) and DELETE (session
 * termination) both only mean something when the server keeps sessions.
 * Stateless mode does not, so it refuses them before a transport is built.
 *
 * 405 is the answer the spec reserves for exactly this, and the client acts on
 * it: it reads 405 on GET as "no server-initiated stream here" and stops
 * asking. Serving GET in stateless mode instead hands back an SSE stream that
 * the per-request `server.close()` tears down within milliseconds, and a client
 * reopens it about once a second for as long as it stays connected — a fresh
 * Server, tool list and transport built and discarded on every pass.
 */
function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Method not allowed." },
    }),
    {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    },
  );
}

/**
 * Tool-level failure. The message names the offending field or command, never
 * a value — see the credential-ref gate in tools.ts.
 */
function toolFailure(
  message: string,
  draftId?: string,
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
  structuredContent?: { draftId: string };
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    ...(draftId === undefined ? {} : { structuredContent: { draftId } }),
  };
}

function createServer(tools: McpTool[]): Server {
  const server = new Server(
    { name: "dashframe", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // TypeBox is JSON Schema, so each tool's advertised schema is passed
      // through as-is. For a read tool that schema is its parameters plus the
      // optional draftId this surface adds — see toMcpTool in tools.ts.
      inputSchema: tool.inputSchema,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (tool === undefined) {
      return toolFailure(
        `Unknown tool "${request.params.name}". Available: ` +
          tools.map((candidate) => candidate.name).join(", "),
      );
    }
    try {
      return await tool.execute(request.params.arguments ?? {});
    } catch (error) {
      // A rejected tool call is a result the agent can act on, not a protocol
      // fault. Thrown JSON-RPC errors reach the agent as a broken connection;
      // isError content reaches it as "that did not work, here is why".
      return toolFailure(
        error instanceof Error ? error.message : String(error),
        draftIdFromBatchError(error),
      );
    }
  });
  return server;
}

/** In-process Streamable HTTP route; all auth remains in the server resolver. */
export function createMcpRoute(opts: McpRouteOptions) {
  const mode = opts.mode ?? "stateful";
  const maxStatefulSessions = opts.maxStatefulSessions ?? 128;
  const statefulSessionTtlMs = opts.statefulSessionTtlMs ?? 30 * 60_000;
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, ActiveMcpSession>();
  let admissionTail: Promise<void> = Promise.resolve();

  async function serializeAdmission<T>(run: () => Promise<T>): Promise<T> {
    const current = admissionTail.catch(() => {}).then(run);
    admissionTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  return async (c: Context): Promise<Response> => {
    let context: Record<string, unknown>;
    try {
      context = await opts.resolveContext(c.req.raw);
    } catch {
      // Never echo the Authorization header or any credential material.
      return jsonRpcError(401, -32001, "Unauthorized MCP request.");
    }
    const key = contextPrincipalKey(context);
    if (key === null) {
      return jsonRpcError(401, -32001, "Unauthorized MCP request.");
    }

    if (mode === "stateful") await sweepExpiredSessions();

    return mode === "stateful"
      ? handleStateful(c, context.principal, key)
      : handleStateless(c, context.principal);
  };

  async function handleStateless(
    c: Context,
    principal: unknown,
  ): Promise<Response> {
    // Checked after auth, so an unauthenticated caller learns nothing about
    // which methods this route serves.
    if (c.req.method !== "POST") {
      return methodNotAllowed();
    }

    // The body is read only after the caller has been authenticated, and is
    // then handed to the transport so the stream is consumed exactly once.
    let parsedBody: unknown;
    try {
      parsedBody = await c.req.raw.json();
    } catch {
      return jsonRpcError(400, -32700, "Parse error: invalid JSON body.");
    }
    if (isJsonRpcBatch(parsedBody)) {
      return jsonRpcError(
        400,
        -32600,
        "Batched JSON-RPC requests are not supported. Send one request per " +
          "call so a draft id applies to the call that carries it.",
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(
      createMcpTools(
        opts.app,
        {
          principal,
          draftId: requestDraftId(parsedBody),
        },
        "stateless",
      ),
    );
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw, { parsedBody });
    } finally {
      await server.close();
    }
  }

  async function handleStateful(
    c: Context,
    principal: unknown,
    key: string,
  ): Promise<Response> {
    const requestedSessionId = c.req.header("mcp-session-id");
    const existing = requestedSessionId
      ? sessions.get(requestedSessionId)
      : undefined;
    if (existing !== undefined && existing.principalKey !== key) {
      return jsonRpcError(
        403,
        -32003,
        "MCP session is not available to this credential.",
      );
    }
    if (existing !== undefined) existing.lastSeenAt = now();

    let parsedBody: unknown;
    if (c.req.method === "POST") {
      try {
        parsedBody = await c.req.raw.json();
      } catch {
        return jsonRpcError(400, -32700, "Parse error: invalid JSON body.");
      }
    }

    let active: ActiveMcpSession;
    if (existing !== undefined) {
      active = existing;
    } else if (requestedSessionId !== undefined) {
      return jsonRpcError(
        404,
        -32001,
        "Unknown MCP session. Re-initialize the connection.",
      );
    } else if (c.req.method === "POST" && isInitializeRequest(parsedBody)) {
      return serializeAdmission(async () => {
        if (sessions.size >= maxStatefulSessions) {
          const eligible = [...sessions.entries()]
            .filter(([, session]) => session.principalKey === key)
            .sort(([, a], [, b]) => a.lastSeenAt - b.lastSeenAt)[0];
          if (eligible === undefined) {
            return jsonRpcError(
              503,
              -32000,
              "MCP session capacity is unavailable.",
            );
          }
          await closeSession(eligible[0]);
        }
        const opened = await openSession(principal, key);
        // Keep admission reserved through handleRequest: the transport inserts
        // into `sessions` only from onsessioninitialized during this call.
        return opened.transport.handleRequest(c.req.raw, { parsedBody });
      });
    } else {
      return jsonRpcError(
        400,
        -32000,
        "Expected an initialize request or an mcp-session-id header.",
      );
    }
    return active.transport.handleRequest(c.req.raw, { parsedBody });
  }

  async function openSession(
    principal: unknown,
    key: string,
  ): Promise<ActiveMcpSession> {
    const context: McpRequestContext = { principal };
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          context,
          principalKey: key,
          transport,
          server,
          lastSeenAt: now(),
        });
      },
      onsessionclosed: async (sessionId) => {
        const closed = sessions.get(sessionId);
        sessions.delete(sessionId);
        await closed?.server.close();
      },
    });
    const server = createServer(createMcpTools(opts.app, context, "stateful"));
    await server.connect(transport);
    return { context, principalKey: key, transport, server, lastSeenAt: now() };
  }

  async function closeSession(sessionId: string): Promise<void> {
    const active = sessions.get(sessionId);
    if (active === undefined) return;
    sessions.delete(sessionId);
    try {
      await active.transport.close();
    } finally {
      await active.server.close();
    }
  }

  async function sweepExpiredSessions(): Promise<void> {
    const cutoff = now() - statefulSessionTtlMs;
    for (const [sessionId, active] of sessions) {
      if (active.lastSeenAt <= cutoff) await closeSession(sessionId);
    }
  }
}
