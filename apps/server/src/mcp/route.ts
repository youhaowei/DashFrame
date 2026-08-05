import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
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

function jsonRpcError(c: Context, message: string): Response {
  return c.json({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32001, message },
  });
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
      throw new Error(`Unknown MCP tool: ${request.params.name}`);
    }
    return tool.execute(request.params.arguments ?? {});
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
      return jsonRpcError(c, "Unauthorized MCP request.");
    }
    const key = principalKey(context);
    if (key === null) return jsonRpcError(c, "Unauthorized MCP request.");

    const requestedSessionId = c.req.header("mcp-session-id");
    let active =
      requestedSessionId === undefined
        ? undefined
        : sessions.get(requestedSessionId);
    if (active !== undefined && active.session.principalKey !== key) {
      return jsonRpcError(
        c,
        "MCP session is not available to this credential.",
      );
    }

    if (active === undefined) {
      const session: McpSession = {
        principal: context.principal,
        principalKey: key,
      };
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
      active = { session, transport, server };
    }

    return active.transport.handleRequest(c.req.raw);
  };
}
