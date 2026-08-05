import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { WyStackApp } from "@wystack/server";
import type { Context } from "hono";

import { createMcpTools, type McpTool } from "./tools";

export interface McpSession {
  draftId?: string;
  principal: unknown;
  principalKey: string;
}

interface McpRouteOptions {
  app: WyStackApp;
  resolveContext(request: Request): Promise<Record<string, unknown>>;
}

interface ActiveMcpSession {
  session: McpSession;
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
}

function principalKey(context: Record<string, unknown>): string | null {
  const principal = context.principal;
  if (typeof principal !== "object" || principal === null) return null;
  const record = principal as Record<string, unknown>;
  if (record.kind === "service" && typeof record.credentialId === "string") {
    return `service:${record.credentialId}`;
  }
  if (record.kind === "user" && typeof record.userId === "string") {
    return `user:${record.userId}`;
  }
  return null;
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
      // TypeBox is JSON Schema. Deliberately pass the original schema through.
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
  const sessions = new Map<string, ActiveMcpSession>();

  return async (c: Context): Promise<Response> => {
    let context: Record<string, unknown>;
    try {
      context = await opts.resolveContext(c.req.raw);
    } catch {
      // Never echo the Authorization header or any credential material.
      return jsonRpcError(401, -32001, "Unauthorized MCP request.");
    }
    const key = principalKey(context);
    if (key === null) {
      return jsonRpcError(401, -32001, "Unauthorized MCP request.");
    }

    const requestedSessionId = c.req.header("mcp-session-id");
    const existing =
      requestedSessionId === undefined
        ? undefined
        : sessions.get(requestedSessionId);
    if (existing !== undefined && existing.session.principalKey !== key) {
      return jsonRpcError(
        403,
        -32003,
        "MCP session is not available to this credential.",
      );
    }

    // The body is read only after the caller has been authenticated, and is
    // then handed to the transport so the stream is consumed exactly once.
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
      // Only an initialize request may mint a session. Without this guard every
      // sessionless POST built a fresh Server and transport that nothing ever
      // reclaimed, so an authenticated caller could exhaust memory by looping
      // any other method at /mcp.
      active = await openSession(context.principal, key);
    } else {
      return jsonRpcError(
        400,
        -32000,
        "Expected an initialize request or an mcp-session-id header.",
      );
    }

    return active.transport.handleRequest(c.req.raw, { parsedBody });
  };

  async function openSession(
    principal: unknown,
    key: string,
  ): Promise<ActiveMcpSession> {
    const session: McpSession = { principal, principalKey: key };
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { session, transport, server });
      },
      onsessionclosed: async (sessionId) => {
        const closed = sessions.get(sessionId);
        sessions.delete(sessionId);
        await closed?.server.close();
      },
    });
    const server = createServer(createMcpTools(opts.app, session));
    await server.connect(transport);
    return { session, transport, server };
  }
}
