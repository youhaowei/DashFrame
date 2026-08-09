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
import { createMcpTools } from "./tools";

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
  let root = "";
  let project: ProjectHandle | null = null;
  let server: DashframeServer | null = null;
  let serviceToken: string;

  async function start(): Promise<void> {
    server?.stop();
    await project?.close();
    server = null;
    project = null;
    if (root !== "") rmSync(root, { recursive: true, force: true });
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
  }

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
    server = null;
    project = null;
    root = "";
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
    const tool = createMcpTools(fakeApp, {
      principal: { kind: "service", credentialId: "test" },
      draftId,
    }).find((candidate) => candidate.name === "find_nodes");

    await expect(tool!.execute({})).rejects.toThrow(/is no longer open/i);
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
        "draft_batch",
      ]);
      for (const tool of listed.tools) {
        const roundTripped = JSON.parse(JSON.stringify(tool.inputSchema)) as {
          type?: string;
          properties?: Record<string, { description?: string }>;
        };
        expect(roundTripped.type).toBe("object");
        expect(Object.getOwnPropertySymbols(roundTripped)).toHaveLength(0);
        if (tool.name !== "draft_batch") {
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
        "secret:<uuid>",
      ]) {
        expect(writeTool?.description).toContain(denied);
      }
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
          // Preserve the assistant boundary's Convert-then-Check contract in
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

  it("opens a fresh draft when a person has already discarded the supplied draft", async () => {
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
        /is no longer open/i,
      );

      const second = await write("After the discard", firstId);
      expect(second.isError).not.toBe(true);
      const secondId = (second.structuredContent as { draftId: string })
        .draftId;
      expect(secondId).not.toBe(firstId);
      expect(
        await project!.db.select().from(schema.draftCommandLog),
      ).toHaveLength(1);
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

  /**
   * A stateless endpoint keeps nothing for a GET stream to carry or a DELETE to
   * terminate. Serving GET is worse than refusing it: the transport hands back
   * an SSE stream that the per-request `server.close()` tears down at once, and
   * a connected client reopens it roughly once a second forever, rebuilding a
   * Server and the whole tool list each time. 405 is the answer the client
   * reads as "no server-initiated stream here", so it stops asking.
   */
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
