import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { WyStackApp } from "@wystack/server";
import type { Context } from "hono";

import { createMcpTools, type McpTool } from "./tools";

export interface McpRequestContext {
  principal: unknown;
  draftId?: string;
}

interface McpRouteOptions {
  app: WyStackApp;
  resolveContext(request: Request): Promise<Record<string, unknown>>;
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
  status: 400 | 401 | 403 | 404 | 500,
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
 * termination) both only mean something when the server keeps sessions. This
 * one does not, so they are refused before a transport is built.
 *
 * 405 is the answer the spec reserves for exactly this, and the client acts on
 * it: it reads 405 on GET as "no server-initiated stream here" and stops
 * asking. Serving GET instead hands back an SSE stream that the per-request
 * `server.close()` tears down within milliseconds, and a connected client
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
  return { content: [{ type: "text", text: message }], isError: true };
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
      );
    }
  });
  return server;
}

/** In-process Streamable HTTP route; all auth remains in the server resolver. */
export function createMcpRoute(opts: McpRouteOptions) {
  return async (c: Context): Promise<Response> => {
    let context: Record<string, unknown>;
    try {
      context = await opts.resolveContext(c.req.raw);
    } catch {
      // Never echo the Authorization header or any credential material.
      return jsonRpcError(401, -32001, "Unauthorized MCP request.");
    }
    if (!isIdentifiedPrincipal(context)) {
      return jsonRpcError(401, -32001, "Unauthorized MCP request.");
    }

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
      createMcpTools(opts.app, {
        principal: context.principal,
        draftId: requestDraftId(parsedBody),
      }),
    );
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw, { parsedBody });
    } finally {
      await server.close();
    }
  };
}
