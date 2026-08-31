import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ApplicationOperations } from "../host/application";
import { HostBatchOutcomeUnknownError } from "../host/commands";
import type { Context } from "hono";

import {
  REPORT_APP_HTML,
  REPORT_APP_MIME_TYPE,
  REPORT_APP_URI,
} from "./report-app";
import { createMcpTools, type McpTool } from "./tools";

const DASHFRAME_ICON =
  "data:image/png;base64,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";

export interface McpRequestContext {
  principal: unknown;
  draftId?: string;
}

export type McpMode = "stateful" | "stateless";

interface McpRouteOptions {
  app: ApplicationOperations;
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
function toolFailure(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function createServer(tools: McpTool[]): Server {
  const server = new Server(
    {
      name: "dashframe",
      title: "DashFrame",
      version: "0.3.0",
      icons: [
        { src: DASHFRAME_ICON, mimeType: "image/png", sizes: ["128x128"] },
      ],
    },
    { capabilities: { resources: {}, tools: {} } },
  );
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: REPORT_APP_URI,
        name: "DashFrame inline data report",
        description:
          "A focused table, chart, or combined view for a server-owned immutable DataFrame.",
        mimeType: REPORT_APP_MIME_TYPE,
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== REPORT_APP_URI) {
      throw new Error("Unknown DashFrame MCP resource.");
    }
    return {
      contents: [
        {
          uri: REPORT_APP_URI,
          mimeType: REPORT_APP_MIME_TYPE,
          text: REPORT_APP_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [] },
            },
            "openai/widgetDescription":
              "Focused DashFrame report with a bounded table or chart and paging when needed.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: [],
            },
          },
        },
      ],
    };
  });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(tool.title === undefined ? {} : { title: tool.title }),
      description: tool.description,
      // TypeBox is JSON Schema, so each tool's advertised schema is passed
      // through as-is. For a read tool that schema is its parameters plus the
      // optional draftId this surface adds — see toMcpTool in tools.ts.
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined
        ? {}
        : { outputSchema: tool.outputSchema }),
      ...(tool.annotations === undefined
        ? {}
        : { annotations: tool.annotations }),
      ...(tool._meta === undefined ? {} : { _meta: tool._meta }),
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
      if (error instanceof HostBatchOutcomeUnknownError) {
        return {
          ...toolFailure(`${error.message}: ${error.operationId}`),
          structuredContent: {
            code: error.code,
            operationId: error.operationId,
          },
        };
      }
      // A rejected tool call is a result the agent can act on, not a protocol
      // fault. Thrown JSON-RPC errors reach the agent as a broken connection;
      // isError content reaches it as "that did not work, here is why".
      return toolFailure(
        error instanceof Error ? error.message : String(error),
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
