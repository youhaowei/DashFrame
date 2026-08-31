/// <reference types="vite/client" />
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { convexTest } from "convex-test";
import schema from "@dashframe/convex-backend/schema";
import type { LocalConvex } from "@dashframe/convex-local";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";
import { createConvexIdentity } from "../convex-identity";
import { createHostMetadata } from "../host/convex-metadata";
import { createApplicationOperations } from "../host/dispatch";
import { createMcpRoute } from "./route";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

describe("MCP durable batch retries", () => {
  it.each(["stateless", "stateful"] as const)(
    "%s returns a lost-acknowledgement retry ID without duplicating commands",
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), "dashframe-mcp-retry-"));
      const native = convexTest(schema, modules);
      const metadata = createHostMetadata(
        {
          query: native.query,
          mutation: native.mutation,
        } as unknown as LocalConvex["internalClient"],
        "w",
      );
      const app = createApplicationOperations({
        convexUrl: "http://unused.test",
        identity: await createConvexIdentity(root, "w"),
        context: (principal) => ({
          principal,
          metadata,
          getServerEndpoint: () => undefined,
        }),
      });
      const http = new Hono();
      http.all(
        "/mcp",
        createMcpRoute({
          app,
          mode,
          resolveContext: async () => ({
            principal: { kind: "service", credentialId: "mcp-test" },
          }),
        }),
      );
      const transport = new StreamableHTTPClientTransport(
        new URL("http://mcp.test/mcp"),
        {
          fetch: async (input, init) => http.fetch(new Request(input, init)),
        },
      );
      const client = new Client({ name: "retry-test", version: "1" });
      try {
        await client.connect(transport);
        const execute = metadata.executeHostBatch.bind(metadata);
        vi.spyOn(metadata, "executeHostBatch").mockImplementationOnce(
          async (input) => {
            await execute(input);
            throw new Error("lost response after commit");
          },
        );
        vi.spyOn(metadata, "settleHostBatch").mockRejectedValueOnce(
          new Error("backend unavailable"),
        );
        const commands = [
          {
            type: "CreateDashboard",
            args: { id: crypto.randomUUID(), name: "One draft command" },
          },
        ];
        const first = await client.callTool({
          name: "draft_batch",
          arguments: { commands },
        });
        expect(first.isError).toBe(true);
        expect(first.structuredContent).toMatchObject({
          code: "HOST_BATCH_OUTCOME_UNKNOWN",
        });
        const operationId = (first.structuredContent as Record<string, unknown>)
          ?.operationId;
        expect(operationId).toEqual(expect.any(String));
        const second = await client.callTool({
          name: "draft_batch",
          arguments: { commands, operationId },
        });
        expect(second.isError).not.toBe(true);
        const state = await native.run(async (ctx) => ({
          drafts: await ctx.db.query("drafts").collect(),
          log: await ctx.db.query("draftLog").collect(),
          batches: await ctx.db.query("hostBatches").collect(),
        }));
        expect(state.drafts).toHaveLength(1);
        expect(state.log).toHaveLength(1);
        expect(state.batches).toHaveLength(1);
        expect(state.batches[0]).toMatchObject({
          operationId,
          status: "completed",
        });
        expect(
          (second.structuredContent as Record<string, unknown>)?.draftId,
        ).toBe(state.drafts[0]?.draftId);
      } finally {
        await transport.close();
        vi.restoreAllMocks();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
