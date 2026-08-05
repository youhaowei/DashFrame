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

const USER_TOKEN = "mcp-test-user-token";

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/**
 * The vault is shared between the access-credential store and the server, so a
 * plaintext credential written through the write tool actually goes somewhere —
 * without one the server refuses to persist and the credential path is never
 * exercised.
 */
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
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;
  let serviceToken: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dashframe-mcp-"));
    project = await openProject({ dir: join(root, "project") });
    const { vault, accessCredentials } = makeVault(join(root, "credentials"));
    server = await createDashframeServer({
      db: project.db,
      accessCredentials,
      vault,
      authToken: USER_TOKEN,
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
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function connect(): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport;
  }> {
    const client = new Client({ name: "dashframe-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${server!.url}/mcp`),
      { requestInit: { headers: bearer(serviceToken) } },
    );
    await client.connect(transport);
    return { client, transport };
  }

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

  it("lists the existing read tools, reads through the service session, and drafts without changing canonical", async () => {
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
        "draft_batch",
      ]);
      for (const tool of listed.tools) {
        const roundTripped = JSON.parse(JSON.stringify(tool.inputSchema)) as {
          type?: string;
        };
        expect(roundTripped.type).toBe("object");
        expect(Object.getOwnPropertySymbols(roundTripped)).toHaveLength(0);
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
        "secret:<uuid>",
      ]) {
        expect(writeTool?.description).toContain(denied);
      }

      const missingId = crypto.randomUUID();
      for (const [name, args] of [
        ["read_neighborhood", { kind: "dataSource", id: missingId }],
        [
          "read_graph",
          { from: { kind: "dataSource", id: missingId }, depth: 0 },
        ],
        ["find_nodes", {}],
        ["read_artifact", { kind: "dataSource", id: missingId }],
        ["read_data", { kind: "dataTable", id: missingId }],
        ["read_source", { file: "apps/server/src/functions/commands.ts" }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
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
        arguments: { name: "Drafted source" },
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
        /caller-supplied secret references/i,
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

  it("stores a plaintext credential as a vault reference and never persists the plaintext", async () => {
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
      expect(written.isError).not.toBe(true);
      expect(JSON.stringify(written).includes(plaintextKey)).toBe(false);

      const log = await project!.db.select().from(schema.draftCommandLog);
      expect(log).toHaveLength(1);
      const loggedArgs = log[0]!.args as { apiKey?: unknown };
      // Capture-before-log rewrote the plaintext into a vault reference before
      // the durable log was written.
      expect(typeof loggedArgs.apiKey === "string").toBe(true);
      expect(String(loggedArgs.apiKey).startsWith("secret:")).toBe(true);
      expect(JSON.stringify(log).includes(plaintextKey)).toBe(false);

      // And canonical gained nothing at all.
      expect(await project!.db.select().from(schema.dataSources)).toHaveLength(
        0,
      );
    } finally {
      await transport.close();
    }
  });

  it("refuses to hand one credential's session to another", async () => {
    const { client, transport } = await connect();
    try {
      const sessionId = transport.sessionId;
      expect(typeof sessionId === "string").toBe(true);

      const issued = await fetch(`${server!.url}/api/issueAccessCredential`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(USER_TOKEN) },
        body: JSON.stringify({ name: "Second integration credential" }),
      });
      expect(issued.status).toBe(200);
      const otherToken = (
        (await issued.json()) as { data: { accessCredential: string } }
      ).data.accessCredential;

      const stolen = await fetch(`${server!.url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
          ...bearer(otherToken),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(stolen.status).toBe(403);

      // The original credential still owns its session.
      const listed = await client.listTools();
      expect(listed.tools.length).toBeGreaterThan(0);
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

  it("only mints a session for an initialize request", async () => {
    // Without this guard every sessionless POST built a fresh server and
    // transport, so an authenticated caller could exhaust memory by looping
    // any other method.
    const notInitialize = await fetch(`${server!.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...bearer(serviceToken),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(notInitialize.status).toBe(400);
    expect(await notInitialize.json()).toMatchObject({
      error: { code: -32000 },
    });

    const unknownSession = await fetch(`${server!.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": crypto.randomUUID(),
        ...bearer(serviceToken),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(unknownSession.status).toBe(404);

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
