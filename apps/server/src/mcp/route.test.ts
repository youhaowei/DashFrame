/// <reference types="vite/client" />
/**
 * MCP protocol round trips through the real SDK and Hono route, backed by native
 * Convex transactions. The test-only metadata gateway is not the host HTTP API;
 * app.test.ts covers host startup, credential issuance, CORS, and authentication.
 */
import { ApiAccessCredentials, CREDENTIAL_CLASS } from "@dashframe/server-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { Hono } from "hono";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { isPrincipal, type Principal } from "@wystack/identity";
import schema from "@dashframe/convex-backend/schema";
import { api } from "@dashframe/convex-backend/api";
import type { ApplicationOperations } from "../host/application";
import { REPORT_APP_MIME_TYPE, REPORT_APP_URI } from "./report-app";
import { createMcpRoute, type McpMode } from "./route";
import { createMcpTools } from "./tools";

const USER_TOKEN = "mcp-test-user-token";
const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);
const makeNative = () => convexTest(schema, modules);
const userPrincipal: Principal = { kind: "user", userId: "local-user" };

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function writeDashboard(client: Client, name: string) {
  return client.callTool({
    name: "draft_batch",
    arguments: {
      commands: [
        {
          type: "CreateDashboard",
          args: { id: crypto.randomUUID(), name },
        },
      ],
    },
  });
}

/** The vault is shared by the access-credential store and server fixture. */
function makeVault(rootDir: string): {
  vault: SecretVault;
  accessCredentials: ApiAccessCredentials;
} {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, accessCredentials: new ApiAccessCredentials(vault, rootDir) };
}

/** Text of a tool result, joined across content blocks. */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("\n");
}

/**
 * A rejected tool call comes back as an isError result the agent can read, not
 * as a thrown JSON-RPC error, so this asserts on the result rather than a
 * rejection.
 */
async function expectToolError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  message: RegExp,
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  expect(resultText(result)).toMatch(message);
}

describe("MCP route", () => {
  let root = "";
  let native: ReturnType<typeof makeNative>;
  let server: { url: string; fetch: (request: Request) => Promise<Response> };
  let serviceToken: string;
  let accessCredentials: ApiAccessCredentials;

  const fetch = (input: string | URL, init?: RequestInit) =>
    server.fetch(new Request(input, init));

  function application(bound?: Principal): ApplicationOperations {
    return {
      forPrincipal: (principal) => application(principal),
      async execute(name, input, context) {
        const principal = bound ?? context?.principal;
        if (!isPrincipal(principal)) throw new Error("Unauthorized");
        const client = native.withIdentity({
          subject:
            principal.kind === "user"
              ? principal.userId
              : principal.credentialId,
          issuer: "https://mcp.test",
          workspaceId: "mcp-workspace",
          principalKind: principal.kind,
          ...(principal.kind === "user"
            ? { userId: principal.userId }
            : { credentialId: principal.credentialId }),
        });
        if (["fetchData", "runInsight", "queryDataFrame"].includes(name)) {
          // Host data-plane failure DTO: exercise the MCP privacy projection,
          // without inventing a DuckDB or provider fixture in a protocol suite.
          return name === "queryDataFrame"
            ? {
                status: "failed",
                code: "FRAME_NOT_FOUND",
                message: "The requested DataFrame is unavailable.",
              }
            : {
                status: "failed",
                code: "FRAME_UNAVAILABLE",
                message: "private diagnostic",
                diagnosticId: "private-id",
                sourceGenerations: ["private-generation"],
              };
        }
        const args = {
          ...(input as Record<string, Value>),
          ...(context?.draftId ? { draftId: context.draftId } : {}),
        };
        const mutations = [
          "draftBatch",
          "discardDraft",
          "commitBatch",
          "reviseDraft",
          "publishDraft",
        ];
        return mutations.includes(name)
          ? client.mutation(
              makeFunctionReference<"mutation", Record<string, Value>, unknown>(
                `app:${name}`,
              ),
              args,
            )
          : client.query(
              makeFunctionReference<"query", Record<string, Value>, unknown>(
                `app:${name}`,
              ),
              args,
            );
      },
    };
  }

  async function start(
    mode: McpMode,
    sessionOptions: {
      mcpMaxStatefulSessions?: number;
      mcpStatefulSessionTtlMs?: number;
      mcpSessionNow?: () => number;
    } = {},
  ): Promise<void> {
    if (root !== "") rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "dashframe-mcp-"));
    native = makeNative();
    accessCredentials = makeVault(join(root, "credentials")).accessCredentials;
    serviceToken = (await accessCredentials.issue("MCP integration test"))
      .token;
    const resolveContext = async (request: Request) => {
      const token = request.headers
        .get("Authorization")
        ?.replace(/^Bearer /, "");
      if (token === USER_TOKEN) return { principal: userPrincipal };
      const credentialId = token
        ? await accessCredentials.authenticate(token)
        : null;
      if (!credentialId) throw new Error("Unauthorized");
      return { principal: { kind: "service" as const, credentialId } };
    };
    const app = application();
    const http = new Hono();
    http.all(
      "/mcp",
      createMcpRoute({
        app,
        mode,
        resolveContext,
        maxStatefulSessions: sessionOptions.mcpMaxStatefulSessions,
        statefulSessionTtlMs: sessionOptions.mcpStatefulSessionTtlMs,
        now: sessionOptions.mcpSessionNow,
      }),
    );
    // Only native operations are exposed here to arrange/inspect state. This
    // gateway intentionally makes no claim about production host URL wiring.
    http.all("/test/native/:operation", async (c) => {
      const context = await resolveContext(c.req.raw);
      const input: unknown =
        c.req.method === "GET"
          ? JSON.parse(c.req.query("args") ?? "{}")
          : await c.req.json();
      try {
        return c.json({
          data: await app.execute(c.req.param("operation"), input, context),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Operation failed";
        return c.json(
          { error: message },
          /permission|forbidden/i.test(message) ? 403 : 400,
        );
      }
    });
    server = {
      url: "http://mcp.test",
      fetch: async (request) => http.fetch(request),
    };
  }

  beforeEach(async () => {
    await start("stateless");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    root = "";
  });

  async function connect(token = serviceToken): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport;
  }> {
    const client = new Client({ name: "dashframe-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${server!.url}/mcp`),
      {
        requestInit: { headers: bearer(token) },
        fetch: async (input, init) => server.fetch(new Request(input, init)),
      },
    );
    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
    return { client, transport };
  }

  it("advertises the DashFrame icon during MCP initialization", async () => {
    const { client, transport } = await connect();
    try {
      const serverInfo = client.getServerVersion();
      expect(serverInfo?.name).toBe("dashframe");
      expect(serverInfo?.title).toBe("DashFrame");
      const icon = serverInfo?.icons?.[0];
      expect(icon?.mimeType).toBe("image/png");
      expect(icon?.sizes).toEqual(["128x128"]);
      expect(icon?.src).toMatch(/^data:image\/png;base64,/);
      const iconData = icon?.src.split(",", 2)[1];
      if (iconData === undefined) throw new Error("Missing MCP icon data.");
      expect(Buffer.from(iconData, "base64").subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    } finally {
      await transport.close();
    }
  });

  it("refuses a draft read when the draft closes during the read", async () => {
    const draftId = crypto.randomUUID();
    let draftChecks = 0;
    const fakeApp: ApplicationOperations = {
      forPrincipal() {
        return this;
      },
      async execute(path) {
        return path === "listDrafts" && draftChecks++ === 0
          ? [{ draftId }]
          : [];
      },
    };
    const tool = createMcpTools(
      fakeApp,
      { principal: { kind: "service", credentialId: "test" }, draftId },
      "stateless",
    ).find((candidate) => candidate.name === "find_nodes");
    await expect(tool!.execute({})).rejects.toThrow(
      /draft (?:is )?unavailable/i,
    );
  });

  it("validates and reads one snapshotted stateful draft handle", async () => {
    const originalDraftId = crypto.randomUUID();
    const replacementDraftId = crypto.randomUUID();
    const requestContext = {
      principal: { kind: "service" as const, credentialId: "test" },
      draftId: originalDraftId,
    };
    let checks = 0;
    const readDraftIds: unknown[] = [];
    const fakeApp: ApplicationOperations = {
      forPrincipal() {
        return this;
      },
      async execute(path, _args, context) {
        if (path === "listDrafts")
          return [
            { draftId: checks++ === 0 ? originalDraftId : replacementDraftId },
          ];
        readDraftIds.push(context?.draftId);
        requestContext.draftId = replacementDraftId;
        return [];
      },
    };
    const tool = createMcpTools(fakeApp, requestContext, "stateful").find(
      (candidate) => candidate.name === "find_nodes",
    );
    await expect(tool!.execute({})).rejects.toThrow(
      /^draft (?:is )?unavailable$/i,
    );
    expect(readDraftIds.length).toBeGreaterThan(0);
    expect(new Set(readDraftIds)).toEqual(new Set([originalDraftId]));
    expect(checks).toBe(2);
  });

  it("renders only a bounded, authorized frame preview without leaking frame internals", async () => {
    const dataFrameId = crypto.randomUUID();
    const dateFieldId = crypto.randomUUID();
    const usersFieldId = crypto.randomUUID();
    const extraFields = Array.from({ length: 99 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `extra_${index}`,
      type: "string",
    }));
    const providerId = crypto.randomUUID();
    const fakeProjectPath = `/private/project/${crypto.randomUUID()}.arrow`;
    const queryCalls: unknown[] = [];
    const fakeApp: ApplicationOperations = {
      forPrincipal() {
        return this;
      },
      async execute(path: string, args: unknown) {
        if (path === "getDataFrameEntry") {
          return {
            id: dataFrameId,
            insightId: crypto.randomUUID(),
            currentInsightResult: false,
            lastRefreshedAt: 1_723_000_000_000,
            sourceId: providerId,
            storage: { type: "file", key: fakeProjectPath },
            analysis: { credentialRef: `secret:${crypto.randomUUID()}` },
          };
        }
        if (path === "queryDataFrame") {
          queryCalls.push(args);
          return {
            status: "ready",
            schema: [
              { id: dateFieldId, name: "date", type: "date" },
              { id: usersFieldId, name: "users", type: "number" },
              ...extraFields,
            ],
            rows: [
              { date: 1_786_406_400_000, users: 42 },
              { date: 1_786_492_800_000, users: 51 },
            ],
            totalCount: 2,
            page: { offset: 0, limit: 50, returned: 2 },
          };
        }
        throw new Error(`Unexpected call: ${path}`);
      },
    };
    const tool = createMcpTools(
      fakeApp,
      { principal: { kind: "service", credentialId: "test" } },
      "stateless",
    ).find((candidate) => candidate.name === "render_data_frame");

    const result = await tool!.execute({ dataFrameId });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "ready",
      report: {
        title: "DashFrame data report",
        view: "table",
        dataFrameId,
        columnCount: 101,
        rows: [
          { [dateFieldId]: 1_786_406_400_000, [usersFieldId]: 42 },
          { [dateFieldId]: 1_786_492_800_000, [usersFieldId]: 51 },
        ],
        totalCount: 2,
        freshness: { state: "stale", fetchedAt: 1_723_000_000_000 },
        page: { offset: 0, limit: 50, returned: 2 },
      },
    });
    expect(
      (result.structuredContent?.report as { schema: unknown[] }).schema,
    ).toHaveLength(100);
    const serialized = JSON.stringify(result);
    expect(serialized.includes(providerId)).toBe(false);
    expect(serialized.includes(fakeProjectPath)).toBe(false);
    expect(serialized.includes("secret:")).toBe(false);
    expect(queryCalls[0]).toEqual({
      dataFrameId,
      offset: 0,
      limit: 10,
    });

    await expect(
      tool!.execute({ dataFrameId, view: "chart" }),
    ).resolves.toMatchObject({
      structuredContent: { status: "ready", report: { view: "chart" } },
    });
  });

  it("keeps server-private frame metadata out of read_artifact", async () => {
    const dataFrameId = crypto.randomUUID();
    const insightId = crypto.randomUUID();
    const fieldId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const storageKey = `/private/project/${crypto.randomUUID()}.arrow`;
    const secretRef = `secret:${crypto.randomUUID()}`;
    const fakeApp: ApplicationOperations = {
      forPrincipal() {
        return this;
      },
      async execute(path: string) {
        if (path !== "getDataFrameEntry")
          throw new Error(`Unexpected read: ${path}`);
        return {
          id: dataFrameId,
          name: "Revenue result",
          insightId,
          fieldIds: [fieldId],
          rowCount: 12,
          columnCount: 1,
          createdAt: 1_723_000_000_000,
          lastRefreshedAt: 1_723_000_001_000,
          currentInsightResult: true,
          storage: { type: "file", key: storageKey },
          primaryKey: "id",
          sourceId,
          definitionId,
          analysis: { credentialRef: secretRef },
        };
      },
    };
    const tool = createMcpTools(
      fakeApp,
      { principal: { kind: "service", credentialId: "test" } },
      "stateless",
    ).find((candidate) => candidate.name === "read_artifact");

    const result = await tool!.execute({
      kind: "dataFrame",
      id: dataFrameId,
    });

    expect(result.structuredContent).toEqual({
      kind: "dataFrame",
      definition: {
        id: dataFrameId,
        name: "Revenue result",
        insightId,
        fieldIds: [fieldId],
        rowCount: 12,
        columnCount: 1,
        createdAt: 1_723_000_000_000,
        lastRefreshedAt: 1_723_000_001_000,
        currentInsightResult: true,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(storageKey);
    expect(serialized).not.toContain(secretRef);
    expect(serialized).not.toContain(sourceId);
    expect(serialized).not.toContain(definitionId);
  });

  it("fails closed when a ready frame page contradicts the report schema", async () => {
    const dataFrameId = crypto.randomUUID();
    const fakeApp: ApplicationOperations = {
      forPrincipal() {
        return this;
      },
      async execute(path: string) {
        if (path === "getDataFrameEntry") return { id: dataFrameId };
        if (path === "queryDataFrame") {
          return {
            status: "ready",
            schema: [{ id: "value", name: "value", type: "number" }],
            rows: [{ value: 1 }],
            totalCount: 1,
            page: { offset: 0, limit: 50, returned: 2 },
          };
        }
        throw new Error(`Unexpected call: ${path}`);
      },
    };
    const tool = createMcpTools(
      fakeApp,
      { principal: { kind: "service", credentialId: "test" } },
      "stateless",
    ).find((candidate) => candidate.name === "render_data_frame");

    await expect(tool!.execute({ dataFrameId })).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        status: "failed",
        code: "FRAME_UNAVAILABLE",
        message: "The requested DataFrame is unavailable.",
      },
    });
  });

  it("returns a schema-shaped render failure for an absent frame", async () => {
    const { client, transport } = await connect();
    try {
      const result = await client.callTool({
        name: "render_data_frame",
        arguments: { dataFrameId: crypto.randomUUID() },
      });
      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          status: "failed",
          code: "FRAME_NOT_FOUND",
          message: "The requested DataFrame is unavailable.",
        },
      });
    } finally {
      await transport.close();
    }
  });

  it("lists the existing read tools, reads through the service principal, and drafts without changing canonical", async () => {
    const { client, transport } = await connect();
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "read_neighborhood",
        "read_graph",
        "find_nodes",
        "read_artifact",
        "read_data",
        "read_source",
        "fetch_data",
        "run_insight",
        "query_data_frame",
        "render_data_frame",
        "draft_batch",
      ]);
      const renderTool = listed.tools.find(
        (tool) => tool.name === "render_data_frame",
      );
      expect(renderTool).toMatchObject({
        title: "Render DashFrame report",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: REPORT_APP_URI },
          "openai/outputTemplate": REPORT_APP_URI,
          "openai/widgetAccessible": true,
        },
      });
      expect(renderTool?.outputSchema).toBeDefined();
      expect(renderTool?.inputSchema).toMatchObject({
        properties: {
          view: {
            anyOf: [
              { const: "table" },
              { const: "chart" },
              { const: "overview" },
            ],
          },
        },
      });
      expect(
        listed.tools.find((tool) => tool.name === "query_data_frame")?._meta,
      ).toMatchObject({
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
      });
      expect(
        (
          listed.tools.find((tool) => tool.name === "query_data_frame")!
            .inputSchema as unknown as {
            properties: { offset: { maximum: number } };
          }
        ).properties.offset.maximum,
      ).toBe(Number.MAX_SAFE_INTEGER);
      for (const tool of listed.tools) {
        const roundTripped = JSON.parse(JSON.stringify(tool.inputSchema)) as {
          type?: string;
          properties?: Record<string, { description?: string }>;
        };
        expect(roundTripped.type).toBe("object");
        expect(Object.getOwnPropertySymbols(roundTripped)).toHaveLength(0);
        expect(tool.outputSchema).toMatchObject({ type: "object" });
        expect(tool.annotations).toMatchObject({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        });
        if (
          ["fetch_data", "run_insight", "query_data_frame"].includes(tool.name)
        ) {
          const oneOf = (tool.outputSchema as { oneOf?: unknown[] }).oneOf;
          expect(oneOf).toHaveLength(2);
          expect(oneOf).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                required: expect.arrayContaining(["status", "code", "message"]),
              }),
            ]),
          );
        }
        if (
          [
            "read_neighborhood",
            "read_graph",
            "find_nodes",
            "read_artifact",
            "read_data",
            "read_source",
          ].includes(tool.name)
        ) {
          expect(roundTripped.properties?.draftId?.description).toBe(
            "Draft id from draft_batch. Pass it to read through that draft's overlay; omit to read canonical state.",
          );
        }
      }

      // The write tool's description is the only thing an agent reads before
      // its first call, so the vocabulary and the denials have to be in it.
      const writeTool = listed.tools.find(
        (tool) => tool.name === "draft_batch",
      );
      expect(writeTool?.description).toContain("# Command vocabulary");
      expect(writeTool?.description).toContain("The batch is atomic");
      expect(writeTool?.description).toContain("resubmit the entire batch");
      expect(writeTool?.description).not.toContain("prefix committed");
      for (const denied of [
        "DeleteNode",
        "GetOrCreateDataSource",
        "publishDraft",
        "never accepts credentials",
      ]) {
        expect(writeTool?.description).toContain(denied);
      }
      expect(writeTool?.description).not.toMatch(
        /plaintext|apiKey|connectionString/i,
      );
      expect(writeTool?.description).toContain(
        "Carry the returned draftId forward",
      );

      // Every read tool, against an empty graph. `isError` alone would pass on
      // a tool that returned nothing at all, so each one asserts the shape it
      // actually promises — the miss is a *result*, not a failure, and the
      // agent has to be able to tell the two apart.
      const missingId = crypto.randomUUID();
      const sourceFile = "apps/server/src/functions/commands.ts";
      const reads: Array<{
        name: string;
        args: Record<string, unknown>;
        structured: Record<string, unknown>;
        text: string;
      }> = [
        {
          name: "read_neighborhood",
          args: { kind: "dataSource", id: missingId },
          structured: { error: "not_found" },
          text: `No artifact found for dataSource ${missingId}.`,
        },
        {
          name: "read_graph",
          // Preserve the assistant boundary's coercion contract; models commonly
          // emit numeric arguments as strings.
          args: { from: { kind: "dataSource", id: missingId }, depth: "0" },
          structured: { reached: [] },
          text: "Reached 0 node(s) within 0 hop(s).",
        },
        {
          name: "find_nodes",
          args: {},
          structured: { hits: [] },
          text: "0 match(es): none",
        },
        {
          name: "read_artifact",
          args: { kind: "dataSource", id: missingId },
          structured: { error: "not_found" },
          text: `No artifact found for dataSource ${missingId}.`,
        },
        {
          name: "read_data",
          args: { kind: "dataTable", id: missingId },
          structured: { error: "not_found" },
          text: `No data artifact found for dataTable ${missingId}.`,
        },
        {
          // No source reader is injected into this fixture, so source
          // contents are unavailable. That refusal is a normal result and
          // must not reach the agent as a failure — which is precisely what a
          // bare `isError` assertion could not tell apart.
          name: "read_source",
          args: { file: sourceFile },
          structured: { error: "not_readable" },
          text: `No readable source for "${sourceFile}" (not allowlisted).`,
        },
      ];
      for (const read of reads) {
        const result = await client.callTool({
          name: read.name,
          arguments: read.args,
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject(read.structured);
        expect(resultText(result)).toContain(read.text);
      }

      const sourceId = crypto.randomUUID();
      const first = await client.callTool({
        name: "draft_batch",
        arguments: {
          commands: [
            {
              type: "CreateDataSource",
              args: { id: sourceId, type: "csv", name: "Drafted source" },
            },
          ],
        },
      });
      expect(first.isError).not.toBe(true);
      const firstDraft = first.structuredContent as { draftId: string };
      expect(firstDraft.draftId).toEqual(expect.any(String));
      expect(
        await native.run((ctx) => ctx.db.query("dataSources").collect()),
      ).toHaveLength(0);
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(1);

      const draftScopedRead = await client.callTool({
        name: "find_nodes",
        arguments: { name: "Drafted source", draftId: firstDraft.draftId },
      });
      expect(draftScopedRead.structuredContent).toMatchObject({
        hits: [
          expect.objectContaining({
            ref: expect.objectContaining({ id: sourceId }),
          }),
        ],
      });
      // A client that shows the model only the text content still has to be
      // able to get from a name to an id.
      expect(resultText(draftScopedRead)).toContain(sourceId);

      const canonicalRead = await client.callTool({
        name: "find_nodes",
        arguments: { name: "Drafted source" },
      });
      expect(canonicalRead.structuredContent).toMatchObject({ hits: [] });

      const listedDrafts = await fetch(
        `${server!.url}/test/native/listDrafts?args=%7B%7D`,
        {
          headers: bearer(USER_TOKEN),
        },
      );
      expect(listedDrafts.status).toBe(200);
      expect(await listedDrafts.json()).toMatchObject({
        data: [
          expect.objectContaining({
            draftId: firstDraft.draftId,
            commandCount: 1,
          }),
        ],
      });

      const second = await client.callTool({
        name: "draft_batch",
        arguments: {
          draftId: firstDraft.draftId,
          commands: [
            {
              type: "CreateDashboard",
              args: { id: crypto.randomUUID(), name: "Drafted dashboard" },
            },
          ],
        },
      });
      expect(second.isError).not.toBe(true);
      expect((second.structuredContent as { draftId: string }).draftId).toBe(
        firstDraft.draftId,
      );
      expect(
        await native.run((ctx) => ctx.db.query("dashboards").collect()),
      ).toHaveLength(0);
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(2);
    } finally {
      await transport.close();
    }
  });

  it("serves the versioned, network-isolated MCP App resource", async () => {
    const { client, transport } = await connect();
    try {
      const listed = await client.listResources();
      expect(listed.resources).toEqual([
        expect.objectContaining({
          uri: REPORT_APP_URI,
          mimeType: REPORT_APP_MIME_TYPE,
          name: "DashFrame inline data report",
        }),
      ]);
      const resource = await client.readResource({ uri: REPORT_APP_URI });
      expect(resource.contents).toHaveLength(1);
      const content = resource.contents[0] as {
        mimeType?: string;
        text?: string;
        _meta?: Record<string, unknown>;
      };
      expect(content.mimeType).toBe(REPORT_APP_MIME_TYPE);
      expect(content._meta).toMatchObject({
        ui: {
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: [] },
        },
        "openai/widgetDescription": expect.any(String),
      });
      expect(content.text).toContain('request("ui/initialize"');
      expect(content.text).toContain('protocolVersion: "2026-01-26"');
      expect(content.text).toContain('"ui/notifications/initialized"');
      expect(content.text).toContain('"ui/notifications/size-changed"');
      expect(content.text).toContain('"ui/resource-teardown"');
      expect(content.text).toContain("ui/notifications/tool-result");
      expect(content.text).toContain('callTool("query_data_frame"');
      expect(content.text).toContain('field.type === "number"');
      expect(content.text).toContain("columnCount: report.columnCount");
      expect(content.text).toContain("The host did not answer ui/initialize.");
      expect(content.text).toContain('"openai:set_globals"');
      expect(content.text).not.toMatch(/\bfetch\s*\(/);
      expect(content.text).not.toMatch(
        /Authorization|Bearer|secret:|file:\/\//i,
      );
    } finally {
      await transport.close();
    }
  });

  it("returns data-domain failures as MCP tool errors without exposing internals", async () => {
    const { client, transport } = await connect();
    try {
      const missing = crypto.randomUUID();
      const calls = [
        [
          "fetch_data",
          {
            insight: {
              baseTableId: crypto.randomUUID(),
              selectedFields: [],
              metrics: [],
            },
          },
        ],
        ["run_insight", { insightId: missing }],
        ["query_data_frame", { dataFrameId: missing, limit: 1 }],
      ] as const;
      for (const [name, arguments_] of calls) {
        const result = await client.callTool({ name, arguments: arguments_ });
        expect(result.isError).toBe(true);
        expect(resultText(result)).toBe("The requested data operation failed.");
        expect(result.structuredContent).toMatchObject({ status: "failed" });
        expect(result.structuredContent).not.toHaveProperty("diagnosticId");
        expect(result.structuredContent).not.toHaveProperty(
          "sourceGenerations",
        );
      }
    } finally {
      await transport.close();
    }
  });

  it("keeps a discarded caller-carried draft id unavailable", async () => {
    const { client, transport } = await connect();
    try {
      const write = async (name: string, draftId?: string) =>
        client.callTool({
          name: "draft_batch",
          arguments: {
            ...(draftId === undefined ? {} : { draftId }),
            commands: [
              {
                type: "CreateDataSource",
                args: { id: crypto.randomUUID(), type: "csv", name },
              },
            ],
          },
        });

      const first = await write("Before the discard");
      expect(first.isError).not.toBe(true);
      const firstId = (first.structuredContent as { draftId: string }).draftId;

      await expectToolError(
        client,
        "find_nodes",
        { name: "Before the discard", draftId: {} },
        /validation failed/i,
      );

      // Out of band, as a person: the draft the agent is carrying goes away.
      const discarded = await fetch(`${server!.url}/test/native/discardDraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ draftId: firstId }),
      });
      expect(discarded.status).toBe(200);

      await expectToolError(
        client,
        "find_nodes",
        { name: "Before the discard", draftId: firstId },
        /draft (?:is )?unavailable/i,
      );

      await expectToolError(
        client,
        "draft_batch",
        {
          draftId: firstId,
          commands: [
            {
              type: "CreateDataSource",
              args: {
                id: crypto.randomUUID(),
                type: "csv",
                name: "After the discard",
              },
            },
          ],
        },
        /draft (?:is )?unavailable/i,
      );
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });

  it("rejects unsafe commands, lifecycle names, and caller-supplied secret refs", async () => {
    const { client, transport } = await connect();
    try {
      await expectToolError(
        client,
        "draft_batch",
        {
          commands: [
            {
              type: "DeleteNode",
              args: { id: crypto.randomUUID() },
            },
          ],
        },
        /not draft-safe/i,
      );
      await expectToolError(
        client,
        "draft_batch",
        {
          commands: [
            {
              type: "GetOrCreateDataSource",
              args: {
                id: crypto.randomUUID(),
                type: "csv",
                name: "Legacy source",
              },
            },
          ],
        },
        /not draft-safe/i,
      );
      // Lifecycle procedures are not command names, so they are denied by the
      // name-level allow-list rather than by the registry-path check. There is
      // no way to express a raw registry path through this tool at all.
      for (const type of [
        "publishDraft",
        "commitBatch",
        "discardDraft",
        "reviseDraft",
      ]) {
        await expectToolError(
          client,
          "draft_batch",
          { commands: [{ type, args: {} }] },
          /is not draft-safe/i,
        );
      }
      await expectToolError(
        client,
        "draft_batch",
        {
          commands: [
            {
              type: "SetDataSourceConfig",
              args: {
                id: crypto.randomUUID(),
                extra: { headers: { Authorization: "Bearer must-not-land" } },
              },
            },
          ],
        },
        /not draft-safe/i,
      );
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(0);
      const rejectedRef = `secret:${crypto.randomUUID()}`;
      const refAttempt = await client.callTool({
        name: "draft_batch",
        arguments: {
          commands: [
            {
              type: "CreateDataSource",
              args: {
                id: crypto.randomUUID(),
                type: "csv",
                name: "Ref attempt",
                apiKey: rejectedRef,
              },
            },
          ],
        },
      });
      expect(refAttempt.isError).toBe(true);
      expect(resultText(refAttempt)).toMatch(
        /credential material.*not accepted/i,
      );
      // Error text may name the field, never the value. Asserted as a boolean
      // so a failure does not print the rejected reference.
      expect(resultText(refAttempt).includes(rejectedRef)).toBe(false);
      expect(JSON.stringify(refAttempt).includes(rejectedRef)).toBe(false);
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });

  it("isolates stateless drafts by credential without leaking handle existence", async () => {
    const owner = await connect();
    let other: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      const sourceId = crypto.randomUUID();
      const opened = await owner.client.callTool({
        name: "draft_batch",
        arguments: {
          commands: [
            {
              type: "CreateDataSource",
              args: { id: sourceId, type: "csv", name: "Owner only" },
            },
          ],
        },
      });
      const draftId = (opened.structuredContent as { draftId: string }).draftId;

      const otherToken = (
        await accessCredentials.issue("Other MCP integration")
      ).token;
      expect(otherToken).not.toBe(serviceToken);
      const ownerCredentialId =
        await accessCredentials.authenticate(serviceToken);
      const otherCredentialId =
        await accessCredentials.authenticate(otherToken);
      expect(otherCredentialId).not.toBe(ownerCredentialId);
      expect(
        (await native.run((ctx) => ctx.db.query("drafts").collect()))[0]?.owner,
      ).toBe(`service:${ownerCredentialId}`);
      const { draftId: humanDraftId } = await native
        .withIdentity({
          subject: "local-user",
          workspaceId: "mcp-workspace",
          principalKind: "user",
          userId: "local-user",
        })
        .mutation(api.app.draftBatch, { commands: [] });
      other = await connect(otherToken);

      await expectToolError(
        other.client,
        "draft_batch",
        {
          draftId,
          commands: [
            {
              type: "CreateDashboard",
              args: { id: crypto.randomUUID(), name: "Must not land" },
            },
          ],
        },
        /^draft (?:is )?unavailable$/i,
      );
      await expectToolError(
        other.client,
        "find_nodes",
        { name: "Owner only", draftId },
        /^draft (?:is )?unavailable$/i,
      );

      const listUrl = new URL(`${server!.url}/test/native/listDrafts`);
      listUrl.searchParams.set("args", JSON.stringify({}));
      const otherList = await fetch(listUrl, { headers: bearer(otherToken) });
      expect((await otherList.json()) as unknown).toMatchObject({ data: [] });

      const humanList = await fetch(listUrl, { headers: bearer(USER_TOKEN) });
      const humanDraftIds = (
        (await humanList.json()) as { data: Array<{ draftId: string }> }
      ).data.map(({ draftId: id }) => id);
      expect(humanDraftIds).toEqual(
        expect.arrayContaining([draftId, humanDraftId]),
      );

      for (const path of ["getDraftLog", "draftPublishReview"]) {
        const url = new URL(`${server!.url}/test/native/${path}`);
        url.searchParams.set("args", JSON.stringify({ draftId }));
        const denied = await fetch(url, { headers: bearer(otherToken) });
        const body = await denied.text();
        expect(body).toMatch(/draft (?:is )?unavailable/i);
        expect(body).not.toContain(draftId);
        expect(body).not.toContain(sourceId);
      }

      const ownerRead = await owner.client.callTool({
        name: "find_nodes",
        arguments: { name: "Owner only", draftId },
      });
      expect(ownerRead.isError).not.toBe(true);

      const humanReview = new URL(
        `${server!.url}/test/native/draftPublishReview`,
      );
      humanReview.searchParams.set("args", JSON.stringify({ draftId }));
      expect(
        await fetch(humanReview, { headers: bearer(USER_TOKEN) }),
      ).toHaveProperty("status", 200);
    } finally {
      await other?.transport.close();
      await owner.transport.close();
    }
  });

  it("rejects plaintext credentials before command dispatch or persistence", async () => {
    const { client, transport } = await connect();
    // The literal never appears in an assertion message: every check below is a
    // boolean or a length, so a failing run prints no secret.
    const plaintextKey = `pk-live-${crypto.randomUUID()}`;
    try {
      const written = await client.callTool({
        name: "draft_batch",
        arguments: {
          commands: [
            {
              type: "CreateDataSource",
              args: {
                id: crypto.randomUUID(),
                type: "rest",
                name: "Credentialed source",
                apiKey: plaintextKey,
              },
            },
          ],
        },
      });
      expect(written.isError).toBe(true);
      expect(resultText(written)).toMatch(/credential material.*not accepted/i);
      expect(JSON.stringify(written).includes(plaintextKey)).toBe(false);

      const log = await native.run((ctx) => ctx.db.query("draftLog").collect());
      expect(log).toHaveLength(0);
      expect(JSON.stringify(log).includes(plaintextKey)).toBe(false);

      // And canonical gained nothing at all.
      expect(
        await native.run((ctx) => ctx.db.query("dataSources").collect()),
      ).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });

  it("keeps the service principal out of canonical commits and draft revision", async () => {
    const { client, transport } = await connect();
    try {
      const drafted = await client.callTool({
        name: "draft_batch",
        arguments: {
          commands: [
            {
              type: "CreateDashboard",
              args: { id: crypto.randomUUID(), name: "Review draft" },
            },
          ],
        },
      });
      const draftId = (drafted.structuredContent as { draftId: string })
        .draftId;
      const commit = await fetch(`${server!.url}/test/native/commitBatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bearer(serviceToken),
        },
        body: JSON.stringify({ commands: [] }),
      });
      expect(commit.status).toBe(403);

      const review = await fetch(
        `${server!.url}/test/native/draftPublishReview?args=${encodeURIComponent(JSON.stringify({ draftId }))}`,
        { headers: bearer(USER_TOKEN) },
      );
      const reviewPayload = (await review.json()) as {
        data: { logSignature: string };
      };
      const revise = await fetch(`${server!.url}/test/native/reviseDraft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bearer(serviceToken),
        },
        body: JSON.stringify({
          draftId,
          expectedLogSignature: reviewPayload.data.logSignature,
          ops: [],
        }),
      });
      expect(revise.status).toBe(403);
    } finally {
      await transport.close();
    }
  });

  it("handles bare tool calls statelessly and carries draft ids between requests", async () => {
    const call = async (id: number, draftId?: string) =>
      fetch(`${server!.url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...bearer(serviceToken),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "draft_batch",
            arguments: {
              ...(draftId === undefined ? {} : { draftId }),
              commands: [
                {
                  type: "CreateDashboard",
                  args: { id: crypto.randomUUID(), name: `Stateless ${id}` },
                },
              ],
            },
          },
        }),
      });

    const first = await call(1);
    expect(first.status).toBe(200);
    expect(first.headers.get("mcp-session-id")).toBeNull();
    const firstBody = (await first.json()) as {
      result: { structuredContent: { draftId: string } };
    };
    const draftId = firstBody.result.structuredContent.draftId;
    expect(draftId).toEqual(expect.any(String));

    const second = await call(2, draftId);
    expect(second.status).toBe(200);
    expect(second.headers.get("mcp-session-id")).toBeNull();
    expect((await second.json()) as unknown).toMatchObject({
      result: { structuredContent: { draftId } },
    });
    expect(
      await native.run((ctx) => ctx.db.query("draftLog").collect()),
    ).toHaveLength(2);

    const malformed = await fetch(`${server!.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...bearer(serviceToken),
      },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
  });

  it("rejects authenticated JSON-RPC arrays with HTTP 400", async () => {
    const response = await fetch(`${server!.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...bearer(serviceToken),
      },
      body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32600 } });
  });

  it("leaves no draft after the first command fails", async () => {
    const { client, transport } = await connect();
    try {
      const missingId = crypto.randomUUID();
      const result = await client.callTool({
        name: "draft_batch",
        arguments: {
          commands: [
            {
              type: "SetChartType",
              args: { id: missingId, visualizationType: "bar" },
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(
        `visualization ${missingId} not found`,
      );
      expect(result.structuredContent).toBeUndefined();
      expect(
        await native.run((ctx) => ctx.db.query("drafts").collect()),
      ).toHaveLength(0);
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });

  /** Stateful mode keeps one credential-bound session and remembered draft. */
  it("preserves configured stateful sessions and server-carried continuity", async () => {
    await start("stateful");
    const { client, transport } = await connect();
    try {
      expect(transport.sessionId).toEqual(expect.any(String));
      const listed = await client.listTools();
      expect(
        listed.tools.find((tool) => tool.name === "find_nodes")?.inputSchema,
      ).not.toMatchObject({ properties: { draftId: expect.anything() } });

      const first = await writeDashboard(client, "Stateful first");
      const second = await writeDashboard(client, "Stateful second");
      const draftId = (first.structuredContent as { draftId: string }).draftId;
      expect(second.structuredContent).toMatchObject({ draftId });

      const read = await client.callTool({
        name: "find_nodes",
        arguments: { name: "Stateful" },
      });
      expect(read.isError).not.toBe(true);
      expect(
        (read.structuredContent as { hits: Array<{ name: string }> }).hits.map(
          ({ name }) => name,
        ),
      ).toEqual(expect.arrayContaining(["Stateful first", "Stateful second"]));

      const discarded = await fetch(`${server!.url}/test/native/discardDraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ draftId }),
      });
      expect(discarded.status).toBe(200);
      await expectToolError(
        client,
        "find_nodes",
        { name: "Stateful" },
        /^draft (?:is )?unavailable$/i,
      );
      const afterClose = await writeDashboard(client, "Stateful replacement");
      expect(afterClose.isError).not.toBe(true);
      expect(afterClose.structuredContent).not.toMatchObject({ draftId });
    } finally {
      await transport.close();
    }
  });

  it("serializes concurrent first stateful writes onto one draft", async () => {
    await start("stateful");
    const { client, transport } = await connect();
    try {
      const [first, second] = await Promise.all([
        writeDashboard(client, "Concurrent first"),
        writeDashboard(client, "Concurrent second"),
      ]);
      const firstId = (first.structuredContent as { draftId: string }).draftId;
      expect(second.structuredContent).toMatchObject({ draftId: firstId });
      expect(
        await native.run((ctx) => ctx.db.query("drafts").collect()),
      ).toHaveLength(1);
      expect(
        await native.run((ctx) => ctx.db.query("draftLog").collect()),
      ).toHaveLength(2);
    } finally {
      await transport.close();
    }
  });

  for (const mode of ["stateless", "stateful"] as const) {
    it(`rolls back all commands after a ${mode} batch failure`, async () => {
      await start(mode);
      const { client, transport } = await connect();
      try {
        const result = await client.callTool({
          name: "draft_batch",
          arguments: {
            commands: [
              {
                type: "CreateDashboard",
                args: {
                  id: crypto.randomUUID(),
                  name: `${mode} rolled back`,
                },
              },
              {
                type: "SetChartType",
                args: { id: crypto.randomUUID(), visualizationType: "bar" },
              },
            ],
          },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(resultText(result)).toMatch(/not found/i);
        expect(
          await native.run((ctx) => ctx.db.query("drafts").collect()),
        ).toHaveLength(0);
        expect(
          await native.run((ctx) => ctx.db.query("draftLog").collect()),
        ).toHaveLength(0);
        expect(
          await native.run((ctx) => ctx.db.query("dashboards").collect()),
        ).toHaveLength(0);

        const continued = await client.callTool({
          name: "draft_batch",
          arguments: {
            commands: [
              {
                type: "CreateDashboard",
                args: { id: crypto.randomUUID(), name: `${mode} continued` },
              },
            ],
          },
        });
        expect(continued.isError).not.toBe(true);
        expect(continued.structuredContent).toMatchObject({
          draftId: expect.any(String),
        });
        expect(
          await native.run((ctx) => ctx.db.query("draftLog").collect()),
        ).toHaveLength(1);
      } finally {
        await transport.close();
      }
    });
  }

  for (const mode of ["stateless", "stateful"] as const) {
    it(`preserves the existing ${mode} draft when an append batch fails`, async () => {
      await start(mode);
      const { client, transport } = await connect();
      try {
        const accepted = await writeDashboard(client, "Already accepted");
        const { draftId } = accepted.structuredContent as { draftId: string };
        const carry = mode === "stateless" ? { draftId } : {};
        const rejected = await client.callTool({
          name: "draft_batch",
          arguments: {
            ...carry,
            commands: [
              {
                type: "CreateDashboard",
                args: { id: crypto.randomUUID(), name: "Must roll back" },
              },
              {
                type: "SetChartType",
                args: { id: crypto.randomUUID(), visualizationType: "bar" },
              },
            ],
          },
        });
        expect(rejected.isError).toBe(true);
        expect(
          await native.run((ctx) => ctx.db.query("drafts").collect()),
        ).toHaveLength(1);
        expect(
          await native.run((ctx) => ctx.db.query("draftLog").collect()),
        ).toHaveLength(1);
        const read = await client.callTool({
          name: "find_nodes",
          arguments: carry,
        });
        expect(read.structuredContent).toMatchObject({
          hits: [expect.objectContaining({ name: "Already accepted" })],
        });
        expect(JSON.stringify(read)).not.toContain("Must roll back");
        const continued = await client.callTool({
          name: "draft_batch",
          arguments: {
            ...carry,
            commands: [
              {
                type: "CreateDashboard",
                args: { id: crypto.randomUUID(), name: "Accepted next" },
              },
            ],
          },
        });
        expect(continued.structuredContent).toMatchObject({ draftId });
        expect(
          await native.run((ctx) => ctx.db.query("draftLog").collect()),
        ).toHaveLength(2);
      } finally {
        await transport.close();
      }
    });
  }

  it("evicts stateful sessions at capacity and after idle expiry", async () => {
    await start("stateful", { mcpMaxStatefulSessions: 1 });
    const first = await connect();
    const firstSessionId = first.transport.sessionId!;
    const second = await connect();
    const evicted = await fetch(`${server!.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": firstSessionId,
        ...bearer(serviceToken),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    expect(evicted.status).toBe(404);
    await second.transport.close();

    let currentTime = 0;
    await start("stateful", {
      mcpStatefulSessionTtlMs: 10,
      mcpSessionNow: () => currentTime,
    });
    const expiring = await connect();
    const expiringId = expiring.transport.sessionId!;
    currentTime = 11;
    const expired = await fetch(`${server!.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": expiringId,
        ...bearer(serviceToken),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }),
    });
    expect(expired.status).toBe(404);
  });

  it("keeps concurrent stateful initialization within capacity one", async () => {
    await start("stateful", { mcpMaxStatefulSessions: 1 });
    const attempts = await Promise.allSettled([connect(), connect()]);
    const connected = attempts.flatMap((attempt) =>
      attempt.status === "fulfilled" ? [attempt.value] : [],
    );
    expect(connected.length).toBeGreaterThanOrEqual(1);

    const statuses = await Promise.all(
      connected.map(({ transport }) =>
        fetch(`${server!.url}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "Mcp-Session-Id": transport.sessionId!,
            ...bearer(serviceToken),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: crypto.randomUUID(),
            method: "tools/list",
          }),
        }).then((response) => response.status),
      ),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    await Promise.allSettled(
      connected.map(({ transport }) => transport.close()),
    );
  });

  it("does not let another credential evict an active stateful session", async () => {
    await start("stateful", { mcpMaxStatefulSessions: 1 });
    const owner = await connect();
    try {
      const challengerToken = (
        await accessCredentials.issue("Capacity challenger")
      ).token;

      await expect(connect(challengerToken)).rejects.toThrow();
      await expect(owner.client.listTools()).resolves.toMatchObject({
        tools: expect.any(Array),
      });
    } finally {
      await owner.transport.close();
    }
  });

  /** Stateless mode has no GET stream or DELETE lifecycle, so both return 405. */
  it("refuses GET and DELETE with 405 so a connected client stops reopening them", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(`${server!.url}/mcp`, {
        method,
        headers: { Accept: "text/event-stream", ...bearer(serviceToken) },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await response.body?.cancel();
    }

    // Unauthenticated callers learn nothing about which methods are served.
    const anonymous = await fetch(`${server!.url}/mcp`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    expect(anonymous.status).toBe(401);
    await anonymous.body?.cancel();
  });

  it("answers missing and invalid credentials with HTTP 401 and opens no draft", async () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    };
    for (const headers of [{}, bearer("not-a-valid-credential")]) {
      const response = await fetch(`${server!.url}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized MCP request." },
      });
    }
    expect(
      await native.run((ctx) => ctx.db.query("drafts").collect()),
    ).toHaveLength(0);
    expect(
      await native.run((ctx) => ctx.db.query("draftLog").collect()),
    ).toHaveLength(0);
  });
});
