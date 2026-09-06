import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import type { ApplicationOperations } from "../host/application";
import { HostBatchOutcomeUnknownError } from "../host/commands";
import { createMcpRoute, type McpMode } from "./route";

describe("MCP draft_batch output schema", () => {
  it.each(["stateless", "stateful"] as const)(
    "%s preserves the retry identity after the client caches tool schemas",
    async (mode: McpMode) => {
      const app: ApplicationOperations = {
        forPrincipal() {
          return this;
        },
        async execute(operation, input) {
          if (operation !== "draftBatch") {
            throw new Error(`Unexpected operation: ${operation}`);
          }
          const operationId = (input as { operationId?: unknown }).operationId;
          if (typeof operationId !== "string") {
            throw new Error("draftBatch did not receive an operation ID");
          }
          throw new HostBatchOutcomeUnknownError(operationId);
        },
      };
      const http = new Hono();
      http.all(
        "/mcp",
        createMcpRoute({
          app,
          mode,
          resolveContext: async () => ({
            principal: { kind: "service", credentialId: "schema-test" },
          }),
        }),
      );
      const transport = new StreamableHTTPClientTransport(
        new URL("http://mcp.test/mcp"),
        {
          fetch: async (input, init) => http.fetch(new Request(input, init)),
        },
      );
      const client = new Client({ name: "schema-test", version: "1" });

      try {
        await client.connect(transport);
        await client.listTools();

        const result = await client.callTool({
          name: "draft_batch",
          arguments: {
            commands: [
              {
                type: "CreateDashboard",
                args: { id: crypto.randomUUID(), name: "Retry schema" },
              },
            ],
          },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
          code: "HOST_BATCH_OUTCOME_UNKNOWN",
          operationId: expect.any(String),
        });
      } finally {
        await transport.close();
      }
    },
  );
});
