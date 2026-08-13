/**
 * MCP protocol round trip. The fixture deliberately mints an access credential
 * through the user-authenticated HTTP surface, then uses only that credential
 * for MCP calls so the tested principal is a service principal.
 */
import {
  ApiAccessCredentials,
  CREDENTIAL_CLASS,
  openProject,
  schema,
  type ProjectHandle,
} from "@dashframe/server-core";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDashframeServer, type DashframeServer } from "../app";
import { REPORT_APP_MIME_TYPE, REPORT_APP_URI } from "./report-app";
import type { McpMode } from "./route";
import { createMcpTools } from "./tools";

const USER_TOKEN = "mcp-test-user-token";

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
  let project: ProjectHandle | null = null;
  let server: DashframeServer | null = null;
  let serviceToken: string;
  let accessCredentials: ApiAccessCredentials;

  async function start(
    mode: McpMode,
    sessionOptions: {
      mcpMaxStatefulSessions?: number;
      mcpStatefulSessionTtlMs?: number;
      mcpSessionNow?: () => number;
    } = {},
  ): Promise<void> {
    server?.stop();
    await project?.close();
    server = null;
    project = null;
    if (root !== "") rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "dashframe-mcp-"));
    project = await openProject({ dir: join(root, "project") });
    const vaultBundle = makeVault(join(root, "credentials"));
    const { vault } = vaultBundle;
    accessCredentials = vaultBundle.accessCredentials;
    server = await createDashframeServer({
      db: project.db,
      accessCredentials,
      vault,
      authToken: USER_TOKEN,
      mcpMode: mode,
      ...sessionOptions,
    });

    const issued = await fetch(`${server.url}/api/issueAccessCredential`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
      body: JSON.stringify({ name: "MCP integration test" }),
    });
    expect(issued.status).toBe(200);
    const payload = (await issued.json()) as {
      data: { accessCredential: string };
    };
    serviceToken = payload.data.accessCredential;
  }

  beforeEach(async () => {
    await start("stateless");
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
    server = null;
    project = null;
    root = "";
  });

  async function connect(token = serviceToken): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport;
  }> {
    const client = new Client({ name: "dashframe-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${server!.url}/mcp`),
      { requestInit: { headers: bearer(token) } },
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
    const fakeApp = {
      createTracked() {
        return {};
      },
      async runHandler() {
        return [];
      },
      async call(path: string) {
        if (path === "listDrafts") {
          return {
            result: draftChecks++ === 0 ? [{ draftId }] : [],
          };
        }
        return { result: [] };
      },
    } as unknown as Parameters<typeof createMcpTools>[0];
    const tool = createMcpTools(
      fakeApp,
      { principal: { kind: "service", credentialId: "test" }, draftId },
      "stateless",
    ).find((candidate) => candidate.name === "find_nodes");

    await expect(tool!.execute({})).rejects.toThrow(/draft is unavailable/i);
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
    const fakeApp = {
      createTracked() {
        return {};
      },
      async runHandler(
        _path: string,
        _args: unknown,
        _tracked: unknown,
        context: Record<string, unknown>,
      ) {
        readDraftIds.push(context.draftId);
        requestContext.draftId = replacementDraftId;
        return [];
      },
      async call(path: string) {
        if (path === "listDrafts") {
          return {
            result:
              checks++ === 0
                ? [{ draftId: originalDraftId }]
                : [{ draftId: replacementDraftId }],
          };
        }
        return { result: [] };
      },
    } as unknown as Parameters<typeof createMcpTools>[0];
    const tool = createMcpTools(fakeApp, requestContext, "stateful").find(
      (candidate) => candidate.name === "find_nodes",
    );

    await expect(tool!.execute({})).rejects.toThrow(/^draft is unavailable$/);
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
    const fakeApp = {
      async call(path: string, args: unknown) {
        if (path === "getDataFrameEntry") {
          return {
            result: {
              id: dataFrameId,
              insightId: crypto.randomUUID(),
              currentInsightResult: false,
              lastRefreshedAt: 1_723_000_000_000,
              sourceId: providerId,
              storage: { type: "file", key: fakeProjectPath },
              analysis: { credentialRef: `secret:${crypto.randomUUID()}` },
            },
          };
        }
        if (path === "queryDataFrame") {
          queryCalls.push(args);
          return {
            result: {
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
            },
          };
        }
        throw new Error(`Unexpected call: ${path}`);
      },
    } as unknown as Parameters<typeof createMcpTools>[0];
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

  it("fails closed when a ready frame page contradicts the report schema", async () => {
    const dataFrameId = crypto.randomUUID();
    const fakeApp = {
      async call(path: string) {
        if (path === "getDataFrameEntry")
          return { result: { id: dataFrameId } };
        if (path === "queryDataFrame") {
          return {
            result: {
              status: "ready",
              schema: [{ id: "value", name: "value", type: "number" }],
              rows: [{ value: 1 }],
              totalCount: 1,
              page: { offset: 0, limit: 50, returned: 2 },
            },
          };
        }
        throw new Error(`Unexpected call: ${path}`);
      },
    } as unknown as Parameters<typeof createMcpTools>[0];
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

  it("mints the credential as a user before the MCP service-principal round trip", async () => {
    const response = await fetch(
      `${server!.url}/api/getAccessCapabilities?args=%7B%7D`,
      {
        headers: bearer(serviceToken),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { canManageCredentials: false },
    });
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
          // The fixture project is an empty temp directory, so nothing is
          // allowlisted for source reads. That refusal is a normal result and
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
      expect(await project!.db.select().from(schema.dataSources)).toHaveLength(
        0,
      );
      expect(
        await project!.db.select().from(schema.draftCommandLog),
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
        `${server!.url}/api/listDrafts?args=%7B%7D`,
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
      expect(await project!.db.select().from(schema.dashboards)).toHaveLength(
        0,
      );
      expect(
        await project!.db.select().from(schema.draftCommandLog),
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
      const discarded = await fetch(`${server!.url}/api/discardDraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ draftId: firstId }),
      });
      expect(discarded.status).toBe(200);

      await expectToolError(
        client,
        "find_nodes",
        { name: "Before the discard", draftId: firstId },
        /draft is unavailable/i,
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
        /draft is unavailable/i,
      );
      expect(
        await project!.db.select().from(schema.draftCommandLog),
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
        await project!.db.select().from(schema.draftCommandLog),
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
        await project!.db.select().from(schema.draftCommandLog),
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

      const issued = await fetch(`${server!.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ name: "Other MCP integration" }),
      });
      expect(issued.status).toBe(200);
      const otherToken = (
        (await issued.json()) as { data: { accessCredential: string } }
      ).data.accessCredential;
      expect(otherToken).not.toBe(serviceToken);
      const ownerCredentialId =
        await accessCredentials.authenticate(serviceToken);
      const otherCredentialId =
        await accessCredentials.authenticate(otherToken);
      expect(otherCredentialId).not.toBe(ownerCredentialId);
      expect(
        (
          await project!.db
            .select({ owner: schema.draftMetadata.ownerPrincipalKey })
            .from(schema.draftMetadata)
        )[0]?.owner,
      ).toBe(`service:${ownerCredentialId}`);
      const legacyDraftId = crypto.randomUUID();
      await project!.db.insert(schema.draftMetadata).values({
        draftId: legacyDraftId,
        baseVersion: new Date(),
        logRevision: 0,
      });
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
        /^draft is unavailable$/i,
      );
      await expectToolError(
        other.client,
        "find_nodes",
        { name: "Owner only", draftId },
        /^draft is unavailable$/i,
      );

      const listUrl = new URL(`${server!.url}/api/listDrafts`);
      listUrl.searchParams.set("args", JSON.stringify({}));
      const otherList = await fetch(listUrl, { headers: bearer(otherToken) });
      expect((await otherList.json()) as unknown).toMatchObject({ data: [] });

      const humanList = await fetch(listUrl, { headers: bearer(USER_TOKEN) });
      const humanDraftIds = (
        (await humanList.json()) as { data: Array<{ draftId: string }> }
      ).data.map(({ draftId: id }) => id);
      expect(humanDraftIds).toEqual(
        expect.arrayContaining([draftId, legacyDraftId]),
      );

      for (const path of ["getDraftLog", "draftPublishReview"]) {
        const url = new URL(`${server!.url}/api/${path}`);
        url.searchParams.set("args", JSON.stringify({ draftId }));
        const denied = await fetch(url, { headers: bearer(otherToken) });
        const body = await denied.text();
        expect(body).toMatch(/draft is unavailable/i);
        expect(body).not.toContain(draftId);
        expect(body).not.toContain(sourceId);
      }

      const ownerRead = await owner.client.callTool({
        name: "find_nodes",
        arguments: { name: "Owner only", draftId },
      });
      expect(ownerRead.isError).not.toBe(true);

      const humanReview = new URL(`${server!.url}/api/draftPublishReview`);
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

      const log = await project!.db.select().from(schema.draftCommandLog);
      expect(log).toHaveLength(0);
      expect(JSON.stringify(log).includes(plaintextKey)).toBe(false);

      // And canonical gained nothing at all.
      expect(await project!.db.select().from(schema.dataSources)).toHaveLength(
        0,
      );
    } finally {
      await transport.close();
    }
  });

  it("answers an MCP preflight with exactly one allow-origin and the session headers", async () => {
    const preflight = await fetch(`${server!.url}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,mcp-session-id",
      },
    });
    expect(preflight.status).toBe(204);
    // getSetCookie-style duplication check: one value, not two concatenated.
    const allowOrigin = preflight.headers.get("access-control-allow-origin");
    expect(allowOrigin?.includes(",")).toBe(false);
    const allowHeaders =
      preflight.headers.get("access-control-allow-headers")?.toLowerCase() ??
      "";
    expect(allowHeaders).toContain("mcp-session-id");
    expect(allowHeaders).toContain("mcp-protocol-version");
    expect(
      preflight.headers.get("access-control-allow-methods")?.toUpperCase(),
    ).toContain("DELETE");
    expect(
      preflight.headers.get("access-control-expose-headers")?.toLowerCase(),
    ).toContain("mcp-session-id");
  });

  it("keeps the service principal out of commit and revise routes", async () => {
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
      const commit = await fetch(`${server!.url}/api/commitBatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bearer(serviceToken),
        },
        body: JSON.stringify({ commands: [] }),
      });
      expect(commit.status).toBe(403);

      const review = await fetch(
        `${server!.url}/api/draftPublishReview?args=${encodeURIComponent(JSON.stringify({ draftId }))}`,
        { headers: bearer(USER_TOKEN) },
      );
      const reviewPayload = (await review.json()) as {
        data: { logSignature: string };
      };
      const revise = await fetch(`${server!.url}/api/reviseDraft`, {
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
      await project!.db.select().from(schema.draftCommandLog),
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

  it("removes a server-opened empty draft after the first command fails", async () => {
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
        `Visualization ${missingId} not found`,
      );
      expect(result.structuredContent).toBeUndefined();
      expect(
        await project!.db.select().from(schema.draftMetadata),
      ).toHaveLength(0);
      expect(
        await project!.db.select().from(schema.draftCommandLog),
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

      const discarded = await fetch(`${server!.url}/api/discardDraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ draftId }),
      });
      expect(discarded.status).toBe(200);
      await expectToolError(
        client,
        "find_nodes",
        { name: "Stateful" },
        /^draft is unavailable$/i,
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
        await project!.db.select().from(schema.draftMetadata),
      ).toHaveLength(1);
      expect(
        await project!.db.select().from(schema.draftCommandLog),
      ).toHaveLength(2);
    } finally {
      await transport.close();
    }
  });

  for (const mode of ["stateless", "stateful"] as const) {
    it(`retains a recoverable owned handle after a ${mode} partial-prefix failure`, async () => {
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
                  name: `${mode} retained prefix`,
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
        const draftId = (result.structuredContent as { draftId: string })
          .draftId;
        expect(draftId).toEqual(expect.any(String));
        expect(resultText(result)).toMatch(/not found/i);

        const continued = await client.callTool({
          name: "draft_batch",
          arguments: {
            ...(mode === "stateless" ? { draftId } : {}),
            commands: [
              {
                type: "CreateDashboard",
                args: { id: crypto.randomUUID(), name: `${mode} continued` },
              },
            ],
          },
        });
        expect(continued.isError).not.toBe(true);
        expect(continued.structuredContent).toMatchObject({ draftId });
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
      const issued = await fetch(`${server!.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ name: "Capacity challenger" }),
      });
      expect(issued.status).toBe(200);
      const challengerToken = (
        (await issued.json()) as { data: { accessCredential: string } }
      ).data.accessCredential;

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
    expect(await project!.db.select().from(schema.draftMetadata)).toHaveLength(
      0,
    );
    expect(
      await project!.db.select().from(schema.draftCommandLog),
    ).toHaveLength(0);
  });
});
